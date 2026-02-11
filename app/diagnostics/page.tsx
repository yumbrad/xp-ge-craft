"use client"

import React, { JSX, useState } from "react"

export default function Diagnostics(): JSX.Element {
    const [ eid, setEID ] = useState<string>("")
    const [ status, setStatus ] = useState<number | null>(null)
    const [ responseText, setResponseText ] = useState<string>("")
    const [ error, setError ] = useState<string | null>(null)
    const [ isLoading, setIsLoading ] = useState<boolean>(false)

    async function runDiagnostics() {
        if (!eid.trim()) {
            setError("Please enter your Egg Inc. ID before running diagnostics.")
            return
        }
        setError(null)
        setStatus(null)
        setResponseText("")
        setIsLoading(true)
        try {
            const response = await fetch(`/api/inventory?eid=${encodeURIComponent(eid)}`)
            setStatus(response.status)
            const text = await response.text()
            try {
                setResponseText(JSON.stringify(JSON.parse(text), null, 2))
            } catch {
                setResponseText(text)
            }
            if (!response.ok) {
                setError("The API returned a non-success status.")
            }
        } catch (caughtError) {
            const message = caughtError instanceof Error ? caughtError.message : "Unable to reach the API."
            setError(message)
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <>
            <h1>LP Craft — Diagnostics</h1>
            <div className="input-section">
                <label>Enter EID:</label>
                <input
                    type="text"
                    value={eid}
                    onChange={event => setEID(event.target.value)}
                    onPaste={event => setEID(event.clipboardData.getData("text"))}
                />
                <button onClick={runDiagnostics} disabled={isLoading}>
                    {isLoading ? "Running..." : "Run Diagnostics"}
                </button>
            </div>
            {error && (
                <div className="error">
                    Diagnostics error: {error}
                </div>
            )}
            {status !== null && (
                <p className="footnote">HTTP status: {status}</p>
            )}
            {responseText && (
                <pre className="diagnostics-output">{responseText}</pre>
            )}
            <p className="footnote">
                Return to the <a href="/">optimizer</a> when you're done.
            </p>
        </>
    )
}
