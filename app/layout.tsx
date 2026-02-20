import Script from "next/script"
import { JSX } from "react"
import { withBasePath } from "../lib/base-path"
import "./globals.css"

export const metadata = {
    title: "LP Craft",
    description: "A linear program crafting XP optimizer",
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode,
}): JSX.Element {
    return (
        <html lang="en">
            <body>
                <Script src={withBasePath("/highs.js")} strategy="beforeInteractive"></Script>
                {children}
            </body>
        </html>
    )
}
