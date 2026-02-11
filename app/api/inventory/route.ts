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
    // Encoded protobuf payload (EggIncFirstContactResponse) from the server.
    message?: Uint8Array,
    compressed?: boolean,
    // Present in payloads but not required for decoding.
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
        let authenticatedPayload: AuthenticatedMessagePayload
        try {
            const decoded = AuthenticatedMessage.decode(responseBytes)
            authenticatedPayload = AuthenticatedMessage.toObject(decoded, {
                defaults: true,
                bytes: Uint8Array, // Preserve bytes for protobuf decoding.
            }) as AuthenticatedMessagePayload
        } catch (authError) {
            const responseDetails = responseError instanceof Error ? responseError.message : String(responseError)
            const authDetails = authError instanceof Error ? authError.message : String(authError)
            throw new Error(`Failed to decode first-contact response (${responseDetails}); authenticated wrapper decode failed (${authDetails})`)
        }
        if (!authenticatedPayload?.message || authenticatedPayload.message.length === 0) {
            const responseDetails = responseError instanceof Error ? responseError.message : String(responseError)
            throw new Error(`Authenticated response contained no payload to decode (${responseDetails})`)
        }
        let payloadBytes = authenticatedPayload.message
        if (authenticatedPayload.compressed) {
            payloadBytes = inflateAuthenticatedMessage(authenticatedPayload.message)
        }
        try {
            return ResponseMessage.decode(payloadBytes)
        } catch (payloadError) {
            const payloadDetails = payloadError instanceof Error ? payloadError.message : String(payloadError)
            throw new Error(`Failed to decode authenticated payload (${payloadDetails})`)
        }
    }
}

// Decompress AuthenticatedMessage payloads which can use different zlib/gzip variants
// depending on server/client builds (inflate, raw deflate, or gzip).
function inflateAuthenticatedMessage(message: Uint8Array): Uint8Array {
    const payload = Buffer.from(message)
    const decompressionAttempts: Array<{ name: string, attempt: () => Uint8Array }> = []
    const isGzip = payload.length >= 2 && payload[0] === 0x1f && payload[1] === 0x8b
    const isZlib = payload.length >= 1 && payload[0] === 0x78
    if (isGzip) {
        decompressionAttempts.push({ name: "unzip", attempt: () => zlib.unzipSync(payload) })
    }
    if (isZlib) {
        decompressionAttempts.push({ name: "inflate", attempt: () => zlib.inflateSync(payload) })
    }
    decompressionAttempts.push({ name: "inflateRaw", attempt: () => zlib.inflateRawSync(payload) })
    if (!isGzip) {
        decompressionAttempts.push({ name: "unzip", attempt: () => zlib.unzipSync(payload) })
    }
    if (!isZlib) {
        decompressionAttempts.push({ name: "inflate", attempt: () => zlib.inflateSync(payload) })
    }
    let lastError: unknown
    for (const { attempt } of decompressionAttempts) {
        try {
            return attempt()
        } catch (error) {
            lastError = error
        }
    }
    const lastErrorMessage = lastError instanceof Error ? lastError.message : String(lastError)
    const attemptNames = decompressionAttempts.map((attempt) => attempt.name).join(", ")
    throw new Error(`Unexpected compression format or corrupted data; failed to decompress authenticated message payload using ${attemptNames} (${lastErrorMessage})`)
}
