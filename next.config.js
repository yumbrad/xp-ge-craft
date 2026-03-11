/** @type {import('next').NextConfig} */
const nextConfig = {
    basePath: "/xp-ge-craft",
    env: {
        NEXT_PUBLIC_BASE_PATH: "/xp-ge-craft",
    },
    async redirects() {
        return [
            {
                source: "/",
                destination: "https://hensin.space",
                permanent: true,
                basePath: false,
            },
            {
                source: "/xp-ge-craft",
                destination: "https://hensin.space",
                permanent: true,
                basePath: false,
            },
            {
                source: "/xp-ge-craft/:path*",
                destination: "https://hensin.space",
                permanent: true,
                basePath: false,
            },
        ]
    },
}

module.exports = nextConfig
