# lp-craft
A linear program that calculates the optimal amount of each artifact to craft to maximize XP

## Update HiGHS
Use `scripts/update-highs.sh` to refresh the browser solver files in `public/`.

- Download latest prebuilt `highs-js` assets:
  - `scripts/update-highs.sh`
- Build from source (for newer core HiGHS tags):
  - `scripts/update-highs.sh --mode build --highs-tag v1.13.1`

Run `scripts/update-highs.sh --help` for all options.

## Main view fields
- **Artifact**: The artifact name from the recipe list.
- **Count**: The optimal number of crafts for that artifact in the LP solution. This count already accounts for recursive requirements, because the LP constraints include both the inventory you start with and any intermediate crafts needed to satisfy higher-tier recipes.
- **XP**: Total XP gained from crafting the listed count (`count × recipe XP`). Since count is recursive-aware, XP is too.
- **GE Cost**: Total GE cost of the listed count (`count × recipe cost`).
- **XP / GE**: The per-GE efficiency based on the total XP and total cost for that artifact.
