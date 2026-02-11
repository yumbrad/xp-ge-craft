# lp-craft
A linear program that calculates the optimal amount of each artifact to craft to maximize XP

## Main view fields
- **Artifact**: The artifact name from the recipe list.
- **Count**: The optimal number of crafts for that artifact in the LP solution. This count already accounts for recursive requirements, because the LP constraints include both the inventory you start with and any intermediate crafts needed to satisfy higher-tier recipes.
- **XP**: Total XP gained from crafting the listed count (`count × recipe XP`). Since count is recursive-aware, XP is too.
- **GE Cost**: Total GE cost of the listed count (`count × recipe cost`).
- **XP / GE**: The per-GE efficiency based on the total XP and total cost for that artifact.
