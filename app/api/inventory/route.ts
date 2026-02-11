import axios from "axios"
import protobuf from "protobufjs"
import path from "path"
import zlib from "zlib"
import { NextRequest } from "next/server"

export const runtime = "nodejs"

export interface Inventory {
    [artifact: string]: number,
}
export interface CraftCounts {
    [artifact: string]: number,
}
export interface CraftingProfile {
    inventory: Inventory,
    craftCounts: CraftCounts,
}

interface BackupInventoryItem {
    artifact?: {
        spec?: {
            name?: string,
            level?: string | number,
            rarity?: string,
        },
    },
    quantity?: number,
}

interface BackupCraftableArtifact {
    spec?: {
        name?: string,
        level?: string | number,
    },
    count?: number,
}

interface AuthenticatedMessagePayload {
    message?: Uint8Array,
    compressed?: boolean,
    originalSize?: number,
}

const BACKUP_URL = "https://www.auxbrain.com/ei/bot_first_contact"
// Update this if the Egg Inc. client/server rejects requests due to an outdated version.
const CLIENT_VERSION = 68
const APP_VERSION = "1.28.0"
const PROTO_PATH = path.join(process.cwd(), "data", "ei.proto")
const LEVEL_INDEX: Record<string, number> = {
    INFERIOR: 0,
    LESSER: 1,
    NORMAL: 2,
    GREATER: 3,
    SUPERIOR: 4,
}
let protoRootPromise: Promise<protobuf.Root> | null = null

/**
 * Gets the inventory associated with an EID.
 */
export async function GET(request: NextRequest): Promise<Response> {
    // Get EID from request query
    const eid = request.nextUrl.searchParams.get("eid")
    if (!eid) {
        return new Response(JSON.stringify({
            error: "no EID provided"
        }), { status: 400 })
    }

    // Get inventory from EID
    try {
        const craftingProfile = await getCraftingProfile(eid)
        return new Response(JSON.stringify(craftingProfile), { status: 200 })
    } catch (error) {
        const details = error instanceof Error ? error.message : "unknown error"
        console.error("Failed to load artifact inventory", error)
        return new Response(JSON.stringify({
            error: "unable to get artifact inventory",
            details,
        }), { status: 500 })
    }
}

/**
 * Fetches and parses the artifact inventory and craft history associated with an EID.
 */
async function getCraftingProfile(eid: string): Promise<CraftingProfile> {
    const root = await getProtoRoot()
    const RequestMessage = root.lookupType("ei.EggIncFirstContactRequest")
    const ResponseMessage = root.lookupType("ei.EggIncFirstContactResponse")
    const AuthenticatedMessage = root.lookupType("ei.AuthenticatedMessage")

    const payload = {
        eiUserId: eid,
        clientVersion: CLIENT_VERSION,
        deviceId: "xp-ge-craft",
        platform: 1,
        rinfo: {
            build: APP_VERSION,
            clientVersion: CLIENT_VERSION,
            platform: "ANDROID",
            version: APP_VERSION,
        },
    }
    const errMsg = RequestMessage.verify(payload)
    if (errMsg) {
        throw new Error(errMsg)
    }

    const message = RequestMessage.create(payload)
    const buffer = RequestMessage.encode(message).finish()
    const formBody = new URLSearchParams({
        data: Buffer.from(buffer).toString("base64"),
    }).toString()
    const response = await axios.post(BACKUP_URL, formBody, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        responseType: "arraybuffer",
    })

    const decodedResponse = decodeFirstContactResponse({
        responseBytes: new Uint8Array(response.data),
        ResponseMessage,
        AuthenticatedMessage,
    })
    const data = ResponseMessage.toObject(decodedResponse, {
        longs: String,
        enums: String,
        defaults: true,
    }) as {
        errorCode?: string | number,
        errorMessage?: string,
        backup?: {
            artifactsDb?: {
                inventoryItems?: BackupInventoryItem[],
                artifactStatus?: BackupCraftableArtifact[],
            },
        },
    }
    if (data.errorCode && data.errorCode !== "NO_ERROR" && data.errorCode !== 0) {
        throw new Error(data.errorMessage || "error fetching backup")
    }

    const inventory = parseInventory(data.backup?.artifactsDb?.inventoryItems || [])
    const craftCounts = parseCraftCounts(data.backup?.artifactsDb?.artifactStatus || [])
    return { inventory, craftCounts }
}

async function getProtoRoot(): Promise<protobuf.Root> {
    if (!protoRootPromise) {
        protoRootPromise = protobuf.load(PROTO_PATH)
    }
    return protoRootPromise
}

function parseInventory(items: BackupInventoryItem[]): Inventory {
    const inventory = {} as Inventory
    for (const item of items) {
        const spec = item.artifact?.spec
        if (!spec || spec.rarity !== "COMMON") {
            continue
        }
        const name = formatSpecName(spec)
        if (!name) {
            continue
        }
        inventory[name] = Math.round(item.quantity || 0)
    }
    return inventory
}

function parseCraftCounts(items: BackupCraftableArtifact[]): CraftCounts {
    const craftCounts = {} as CraftCounts
    for (const item of items) {
        const name = formatSpecName(item.spec)
        if (!name) {
            continue
        }
        craftCounts[name] = item.count || 0
    }
    return craftCounts
}

function formatSpecName(spec?: { name?: string, level?: string | number }): string | null {
    if (!spec?.name || spec.name === "UNKNOWN" || spec.level == null) {
        return null
    }
    const levelIndex = typeof spec.level === "number"
        ? spec.level
        : LEVEL_INDEX[spec.level] ?? null
    if (levelIndex == null) {
        return null
    }
    const tier = levelIndex + 1
    return `${spec.name.toLowerCase()}_${tier}`
}

function decodeFirstContactResponse(options: {
    responseBytes: Uint8Array,
    ResponseMessage: protobuf.Type,
    AuthenticatedMessage: protobuf.Type,
}): protobuf.Message {
    const { responseBytes, ResponseMessage, AuthenticatedMessage } = options
    try {
        return ResponseMessage.decode(responseBytes)
    } catch (responseError) {
        let authenticated: AuthenticatedMessagePayload
        try {
            const decoded = AuthenticatedMessage.decode(responseBytes)
            authenticated = AuthenticatedMessage.toObject(decoded, {
                defaults: true,
                bytes: Uint8Array,
            }) as AuthenticatedMessagePayload
        } catch {
            throw responseError
        }
        if (!authenticated?.message || authenticated.message.length === 0) {
            throw responseError
        }
        const payloadBytes = authenticated.compressed
            ? inflateAuthenticatedMessage(authenticated.message)
            : authenticated.message
        return ResponseMessage.decode(payloadBytes)
    }
}

// AuthenticatedMessage payloads may be encoded with different zlib/gzip variants.
function inflateAuthenticatedMessage(message: Uint8Array): Uint8Array {
    const payload = Buffer.from(message)
    try {
        return zlib.inflateSync(payload)
    } catch (inflateError) {
        try {
            return zlib.inflateRawSync(payload)
        } catch (inflateRawError) {
            try {
                return zlib.unzipSync(payload)
            } catch (unzipError) {
                const errorDetails = [inflateError, inflateRawError, unzipError]
                    .map((error) => error instanceof Error ? error.message : String(error))
                    .join(" | ")
                throw new Error(`Unable to decompress authenticated message payload (${errorDetails})`)
            }
        }
    }
}
