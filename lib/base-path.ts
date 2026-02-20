export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || ""

export function withBasePath(path: string): string {
    if (!path.startsWith("/")) {
        throw new Error(`Expected absolute path, received "${path}"`)
    }
    return `${BASE_PATH}${path}`
}
