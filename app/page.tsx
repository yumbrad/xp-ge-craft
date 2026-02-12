"use client"

import type { CraftingProfile } from "./api/inventory/route"
import useHighs from "../hooks/use-highs"
import { Highs, Solution, optimizeCrafts } from "../lib/optimize"
import React, { JSX, useState, useEffect } from "react"

type SortKey = "name" | "xp" | "xpPerGe"
type InventoryResponse = CraftingProfile & { error?: string, details?: string }

/**
 * Fetches artifact data and runs the linear program solver.
 */
async function getOptimalCrafts(highs: Highs, eid: string): Promise<Solution> {
    const response = await fetch(`/api/inventory?eid=${encodeURIComponent(eid)}`)
    let data: InventoryResponse | null = null
    try {
        data = await response.json()
    } catch {
        data = null
    }
    if (!response.ok) {
        const message = data?.details || data?.error || `Request failed (${response.status})`
        throw new Error(message)
    }
    if (!data?.inventory) {
        throw new Error("No inventory data returned from the server.")
    }
    const craftCounts = data.craftCounts
    if (!craftCounts) {
        console.warn("Craft count data missing from API response.")
    }
    return optimizeCrafts(highs, data.inventory, craftCounts || {})
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

function formatPercent(value: number): string {
    return `${(value * 100).toFixed(1)}%`
}

function getXpTooltip(xpPerCraft: number, count: number): string {
    return `XP per craft: ${xpPerCraft.toLocaleString()}\nCrafts: ${count.toLocaleString()}`
}

function getCostTooltip(artifact: string, craft: Solution["crafts"][string]): string {
    const costDetails = craft.costDetails
    const plannedCrafts = Math.max(0, Math.round(craft.count))
    const craftLabel = plannedCrafts === 1 ? "craft" : "crafts"
    const lines = [
        `Artifact: ${artifact}`,
        `Crafts: ${craft.count.toLocaleString()}`,
        `Base GE cost: ${costDetails.baseCost.toLocaleString()}`,
        `Craft history: ${costDetails.craftCount.toLocaleString()}`,
        `Current discount: ${formatPercent(costDetails.discountPercent)}`,
        `Next craft cost: ${costDetails.discountedCost.toLocaleString()} GE`,
        `Direct GE cost in table (${plannedCrafts.toLocaleString()} ${craftLabel}): ${costDetails.totalDirectCost.toLocaleString()} GE`,
    ]
    if (costDetails.ingredients.length > 0) {
        lines.push("Ingredient direct costs for one parent craft (sequential discounts):")
        for (const ingredient of costDetails.ingredients) {
            lines.push(`- ${ingredient.name} x${ingredient.quantity}: starts at ${ingredient.discountedCost.toLocaleString()} GE (${formatPercent(ingredient.discountPercent)} discount, ${ingredient.craftCount.toLocaleString()} crafts) -> total ${ingredient.totalCost.toLocaleString()} GE`)
        }
    }
    if (costDetails.recursiveCost > 0) {
        lines.push(`Recursive cost per craft from scratch (with sequential ingredient discounts): ${costDetails.recursiveCost.toLocaleString()} GE`)
    }
    return lines.join("\n")
}

export default function Home(): JSX.Element {
    const highs = useHighs()
    const [ eid, setEID ] = useState<string>("")
    const [ solution, setSolution ] = useState<Solution | null>(null)
    const [ sortKey, setSortKey ] = useState<SortKey>("name")
    const [ error, setError ] = useState<string | null>(null)
    const [ isLoading, setIsLoading ] = useState<boolean>(false)
    const normalizedError = error ? error.trim() : ""
    const errorMessage = error
        ? (/^(unable|request failed)/i.test(normalizedError)
            ? normalizedError
            : `Unable to calculate. ${normalizedError}`)
        : null

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
            setError("Solver is still loading. Please try again in a moment.")
            return
        }
        if (!eid.trim()) {
            setError("Please enter your Egg Inc. ID before calculating.")
            return
        }
        setError(null)
        setSolution(null)
        setIsLoading(true)
        try {
            window.localStorage["eid"] = eid
            const result = await getOptimalCrafts(highs, eid)
            setSolution(result)
        } catch (caughtError) {
            const message = caughtError instanceof Error ? caughtError.message : "Unable to load inventory."
            setError(message)
        } finally {
            setIsLoading(false)
        }
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
                <button onClick={runOptimize} disabled={isLoading || !highs}>
                    {isLoading ? "Calculating..." : "Calculate"}
                </button>
            </div>
            {errorMessage && (
                <div className="error">
                    {errorMessage}{" "}
                    <a href="/diagnostics">Open diagnostics</a>.
                </div>
            )}
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
                                    <td className="num">
                                        {solution.crafts[artifact].count.toLocaleString()}
                                    </td>
                                    <td className="num">
                                        <span className="value-tooltip" title={getXpTooltip(solution.crafts[artifact].xpPerCraft, solution.crafts[artifact].count)}>
                                            {solution.crafts[artifact].xp.toLocaleString()}
                                        </span>
                                    </td>
                                    <td className="num">
                                        <span className="value-tooltip" title={getCostTooltip(artifact, solution.crafts[artifact])}>
                                            {solution.crafts[artifact].cost.toLocaleString()}
                                        </span>
                                    </td>
                                    <td className="num">
                                        {solution.crafts[artifact].xpPerGe.toFixed(2)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <p className="footnote">
                        * This view calculates the optimal crafts that maximize XP based on your current inventory.
                        Counts and costs include any intermediate crafts required to build higher-tier items, and GE
                        costs reflect your personal crafting history discounts. Need help? Visit{" "}
                        <a href="/diagnostics">diagnostics</a>.
                    </p>
                </>
            )}
            {!solution && (
                <p className="footnote">
                    * Enter your Egg Inc. ID and calculate to see the optimal crafting plan, including XP totals and
                    discounted GE costs based on your crafting history. Need help? Visit{" "}
                    <a href="/diagnostics">diagnostics</a>.
                </p>
            )}
        </>
    )
}
