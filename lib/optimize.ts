import type { CraftCounts, Inventory } from "../app/api/inventory/route"
import { Recipes, recipes } from "../data/recipes"

export interface Highs {
    solve: (problem: string) => any,
}
export interface Solution {
    crafts: {
        [artifact: string]: {
            count: number,
            xp: number,
            cost: number,
            xpPerGe: number,
            xpPerCraft: number,
            costDetails: CostDetails,
        },
    },
    totalXp: number,
    totalCost: number,
}

export interface CostDetails {
    baseCost: number,
    discountedCost: number,
    craftCount: number,
    discountPercent: number,
    recursiveCost: number,
    ingredients: IngredientCost[],
}

export interface IngredientCost {
    name: string,
    quantity: number,
    baseCost: number,
    discountedCost: number,
    craftCount: number,
    discountPercent: number,
}

/**
 * Calculates the crafts to maximize XP given the artifacts in an inventory.
 */
export function optimizeCrafts(highs: Highs, inventory: Inventory, craftCounts: CraftCounts = {}): Solution {
    // Run the highs solver on the LP problem
    const problem = getProblem(inventory)
    console.log(problem)
    const solution = highs.solve(problem)
    console.log("Solution:", solution)

    // Store each craft and recompute the total XP
    const result = {
        crafts: {},
        totalXp: 0,
        totalCost: 0,
    } as Solution
    const recursiveCosts = {} as Record<string, number>
    for (const artifact in solution.Columns) {
        if (recipes[artifact]) {
            const count = solution.Columns[artifact].Primal
            const xpPerCraft = recipes[artifact].xp
            const xp = count * xpPerCraft
            const costDetails = getCostDetails(recipes, craftCounts, recursiveCosts, artifact)
            const cost = count * costDetails.discountedCost
            const xpPerGe = cost > 0 ? xp / cost : 0
            result.crafts[artifact] = { count, xp, cost, xpPerGe, xpPerCraft, costDetails }
            result.totalXp += xp
            result.totalCost += cost
        }
    }

    return result
}

function getCostDetails(
    recipes: Recipes,
    craftCounts: CraftCounts,
    recursiveCosts: Record<string, number>,
    artifact: string,
): CostDetails {
    const recipe = recipes[artifact]
    if (!recipe) {
        return {
            baseCost: 0,
            discountedCost: 0,
            craftCount: 0,
            discountPercent: 0,
            recursiveCost: 0,
            ingredients: [],
        }
    }

    const craftCount = craftCounts[artifact] || 0
    const { discountedCost, discountPercent } = getDiscountedCost(recipe.cost, craftCount)
    return {
        baseCost: recipe.cost,
        discountedCost,
        craftCount,
        discountPercent,
        recursiveCost: getRecursiveCost(recipes, craftCounts, recursiveCosts, artifact),
        ingredients: getIngredientCosts(recipes, craftCounts, artifact),
    }
}

function getIngredientCosts(
    recipes: Recipes,
    craftCounts: CraftCounts,
    artifact: string,
): IngredientCost[] {
    const recipe = recipes[artifact]
    if (!recipe) {
        return []
    }
    return Object.entries(recipe.ingredients).map(([name, quantity]) => {
        const ingredientRecipe = recipes[name]
        const baseCost = ingredientRecipe ? ingredientRecipe.cost : 0
        const craftCount = craftCounts[name] || 0
        const { discountedCost, discountPercent } = getDiscountedCost(baseCost, craftCount)
        return {
            name,
            quantity,
            baseCost,
            discountedCost,
            craftCount,
            discountPercent,
        }
    })
}

function getRecursiveCost(
    recipes: Recipes,
    craftCounts: CraftCounts,
    recursiveCosts: Record<string, number>,
    artifact: string,
): number {
    if (artifact in recursiveCosts) {
        return recursiveCosts[artifact]
    }
    const recipe = recipes[artifact]
    if (!recipe) {
        recursiveCosts[artifact] = 0
        return 0
    }
    const craftCount = craftCounts[artifact] || 0
    const { discountedCost } = getDiscountedCost(recipe.cost, craftCount)
    let totalCost = discountedCost
    for (const [ingredient, quantity] of Object.entries(recipe.ingredients)) {
        totalCost += quantity * getRecursiveCost(recipes, craftCounts, recursiveCosts, ingredient)
    }
    recursiveCosts[artifact] = totalCost
    return totalCost
}

function getDiscountedCost(baseCost: number, craftCount: number): { discountedCost: number, discountPercent: number } {
    if (baseCost <= 0) {
        return { discountedCost: 0, discountPercent: 0 }
    }
    const progress = Math.min(1, craftCount / 300)
    const multiplier = 1 - 0.9 * Math.pow(progress, 0.2)
    const discountedCost = Math.floor(baseCost * multiplier)
    const discountPercent = baseCost > 0 ? 1 - discountedCost / baseCost : 0
    return { discountedCost, discountPercent }
}

/**
 * Generates a linear program problem in CPLEX format.
 */
function getProblem(inventory: Inventory): string {
    // Sort artifacts for determinism
    const lines = [] as string[]
    const artifacts = Object.keys(recipes).sort()

    // Generate the maximum XP objective
    lines.push("Maximize")
    lines.push(`  obj: ${getObjective(recipes, artifacts)}`)

    // Add a resource constraint for each artifact
    lines.push("Subject To")
    for (const artifact of artifacts) {
        const constraint = getConstraint(recipes, inventory, artifact)
        if (constraint) {
            lines.push(`  c_${artifact}: ${constraint}`)
        }
    }

    // Restrict craft counts to positive numbers
    lines.push("Bounds")
    for (const artifact of artifacts) {
        lines.push(`  ${artifact} >= 0`)
    }

    // Specify all variables as integers
    lines.push("General")
    lines.push(`  ${artifacts.join(" ")}`)
    lines.push("End")

    return lines.join("\n")
}

/**
 * Generates the XP maximization objective for a recipe list.
 */
function getObjective(recipes: Recipes, artifacts: string[]): string {
    const crafts = [] as string[]
    for (const artifact of artifacts) {
        if (recipes[artifact]) {
            crafts.push(`${recipes[artifact].xp} ${artifact}`)
        }
    }
    return crafts.join(" + ")
}

/**
 * Generates a resource constraint inequality for an artifact. The total quantity
 * used in each craft that uses the artifact must be bounded by the inventory count
 * plus the number crafted.
 */
function getConstraint(recipes: Recipes, inventory: Inventory, artifact: string): string | null {
    const used = [] as string[]
    for (const parent in recipes) {
        if (recipes[parent] && artifact in recipes[parent].ingredients) {
            used.push(`${recipes[parent].ingredients[artifact]} ${parent}`)
        }
    }
    if (used.length == 0) {
        return null
    }

    const available = inventory[artifact] || 0
    if (recipes[artifact]) {
        return `${used.join(" + ")} - ${artifact} <= ${available}`
    }
    return `${used.join(" + ")} <= ${available}`
}
