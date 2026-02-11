"use client"

import { Inventory } from "./api/inventory/route"
import useHighs from "../hooks/use-highs"
import { Highs, Solution, optimizeCrafts } from "../lib/optimize"
import React, { JSX, useState, useEffect } from "react"

type SortKey = "name" | "xp" | "xpPerGe"

/**
 * Fetches artifact data and runs the linear program solver.
 */
async function getOptimalCrafts(highs: Highs, eid: string): Promise<Solution> {
    const inventory = await fetch(`/api/inventory?eid=${eid}`)
        .then(response => response.json())
        .then(data => data as Inventory)
    return optimizeCrafts(highs, inventory)
}

/**
 * Returns sorted artifact keys based on the selected sort key.
 */
function getSortedArtifacts(solution: Solution, sortKey: SortKey): string[] {
    const keys = Object.keys(solution.crafts)
    switch (sortKey) {
        case "name":
            return keys.sort()
        case "xp":
            return keys.sort((a, b) => solution.crafts[b].xp - solution.crafts[a].xp)
        case "xpPerGe":
            return keys.sort((a, b) => solution.crafts[b].xpPerGe - solution.crafts[a].xpPerGe)
        default:
            return keys.sort()
    }
}

export default function Home(): JSX.Element {
    const highs = useHighs()
    const [ eid, setEID ] = useState<string>("")
    const [ solution, setSolution ] = useState<Solution | null>(null)
    const [ sortKey, setSortKey ] = useState<SortKey>("name")

    // Load the EID from localstorage
    useEffect(() => {
        if (window.localStorage["eid"]) {
            setEID(window.localStorage["eid"])
        }
    }, [])

    /**
     * Set the input field value to the event value.
     */
    function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
        if ((event.nativeEvent as any).inputType === "insertFromPaste") {
            return
        }
        setEID(event.target.value)
    }

    /**
     * Save the EID in local storage and run the optimization.
     */
    async function runOptimize() {
        if (!highs) {
            return
        }
        window.localStorage["eid"] = eid
        const result = await getOptimalCrafts(highs, eid)
        setSolution(result)
    }

    return (
        <>
            <h1>LP Craft — XP Optimizer</h1>
            <div className="input-section">
                <label>Enter EID:</label>
                <input
                    type="text"
                    value={eid}
                    onChange={handleChange}
                    onPaste={event => setEID(event.clipboardData.getData("text"))}
                />
                <button onClick={runOptimize}>Calculate</button>
            </div>
            {solution && (
                <>
                    <div className="summary">
                        <div className="summary-card">
                            <div className="label">Total XP</div>
                            <div className="value">{solution.totalXp.toLocaleString()}</div>
                        </div>
                        <div className="summary-card">
                            <div className="label">Total GE Cost</div>
                            <div className="value">{solution.totalCost.toLocaleString()}</div>
                        </div>
                    </div>
                    <div className="sort-section">
                        <span>Sort by:</span>
                        <button className={sortKey === "name" ? "active" : ""} onClick={() => setSortKey("name")}>Name</button>
                        <button className={sortKey === "xp" ? "active" : ""} onClick={() => setSortKey("xp")}>Total XP</button>
                        <button className={sortKey === "xpPerGe" ? "active" : ""} onClick={() => setSortKey("xpPerGe")}>XP / GE</button>
                    </div>
                    <table className="results-table">
                        <thead>
                            <tr>
                                <th>Artifact</th>
                                <th className="num">Count</th>
                                <th className="num">XP</th>
                                <th className="num">GE Cost</th>
                                <th className="num">XP / GE</th>
                            </tr>
                        </thead>
                        <tbody>
                            {getSortedArtifacts(solution, sortKey).map(artifact => (
                                <tr key={artifact}>
                                    <td className="artifact-name">{artifact}</td>
                                    <td className="num">{solution.crafts[artifact].count.toLocaleString()}</td>
                                    <td className="num">{solution.crafts[artifact].xp.toLocaleString()}</td>
                                    <td className="num">{solution.crafts[artifact].cost.toLocaleString()}</td>
                                    <td className="num">{solution.crafts[artifact].xpPerGe.toFixed(2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </>
            )}
        </>
    )
}