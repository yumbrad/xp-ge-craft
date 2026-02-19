#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage:
  scripts/update-highs.sh [--mode release|build] [options]

Modes:
  release (default)  Download latest prebuilt highs.js/highs.wasm from highs-js.
  build              Build highs.js/highs.wasm from source (requires emscripten toolchain).

Options:
  --mode MODE                release | build
  --target-dir DIR           Output directory for highs.js and highs.wasm (default: public)
  --highs-js-ref REF         highs-js git ref for build mode (default: main)
  --highs-tag TAG            HiGHS git tag/ref for build mode (default: keep highs-js submodule ref)
  --workdir DIR              Working directory for build mode (default: temporary directory)
  --keep-workdir             Keep build workdir after completion
  --force                    Remove existing --workdir before cloning (build mode only)
  --help                     Show this help text

Examples:
  scripts/update-highs.sh
  scripts/update-highs.sh --mode build --highs-tag v1.13.1
  scripts/update-highs.sh --mode build --highs-js-ref v1.8.0 --highs-tag v1.13.1
EOF
}

require_cmd() {
    local command_name="$1"
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "Missing required command: $command_name" >&2
        exit 1
    fi
}

sha256_file() {
    local file="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$file"
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$file"
    else
        echo "SHA256 unavailable (sha256sum/shasum not found): $file"
    fi
}

mode="release"
target_dir="public"
highs_js_ref="main"
highs_tag=""
workdir=""
keep_workdir="false"
force="false"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --mode)
            mode="${2:-}"
            shift 2
            ;;
        --target-dir)
            target_dir="${2:-}"
            shift 2
            ;;
        --highs-js-ref)
            highs_js_ref="${2:-}"
            shift 2
            ;;
        --highs-tag)
            highs_tag="${2:-}"
            shift 2
            ;;
        --workdir)
            workdir="${2:-}"
            shift 2
            ;;
        --keep-workdir)
            keep_workdir="true"
            shift
            ;;
        --force)
            force="true"
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            usage >&2
            exit 1
            ;;
    esac
done

if [[ "$mode" != "release" && "$mode" != "build" ]]; then
    echo "Invalid mode: $mode" >&2
    usage >&2
    exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

if [[ "$target_dir" = /* ]]; then
    target_dir_abs="$target_dir"
else
    target_dir_abs="$repo_root/$target_dir"
fi
mkdir -p "$target_dir_abs"

download_release() {
    require_cmd curl
    local tmpdir
    tmpdir="$(mktemp -d)"
    trap 'rm -rf "$tmpdir"' RETURN

    local js_url="https://lovasoa.github.io/highs-js/highs.js"
    local wasm_url="https://lovasoa.github.io/highs-js/highs.wasm"

    echo "Downloading prebuilt highs-js assets..."
    curl -fL "$js_url" -o "$tmpdir/highs.js"
    curl -fL "$wasm_url" -o "$tmpdir/highs.wasm"

    install -m 0644 "$tmpdir/highs.js" "$target_dir_abs/highs.js"
    install -m 0644 "$tmpdir/highs.wasm" "$target_dir_abs/highs.wasm"

    echo "Updated:"
    ls -l "$target_dir_abs/highs.js" "$target_dir_abs/highs.wasm"
    sha256_file "$target_dir_abs/highs.js"
    sha256_file "$target_dir_abs/highs.wasm"
}

build_from_source() {
    require_cmd git
    require_cmd cmake
    require_cmd make
    require_cmd emcc
    require_cmd emcmake
    require_cmd emmake

    local should_clean="false"
    local build_root
    if [[ -n "$workdir" ]]; then
        if [[ "$workdir" = /* ]]; then
            build_root="$workdir"
        else
            build_root="$repo_root/$workdir"
        fi
        if [[ -e "$build_root" ]]; then
            if [[ "$force" == "true" ]]; then
                rm -rf "$build_root"
            else
                echo "Workdir already exists: $build_root (use --force to remove it)" >&2
                exit 1
            fi
        fi
        mkdir -p "$build_root"
    else
        build_root="$(mktemp -d)"
        should_clean="true"
    fi

    if [[ "$keep_workdir" != "true" && "$should_clean" == "true" ]]; then
        trap 'rm -rf "$build_root"' RETURN
    fi

    local repo_dir="$build_root/highs-js"
    echo "Cloning highs-js into: $repo_dir"
    git clone --recursive https://github.com/lovasoa/highs-js.git "$repo_dir"
    git -C "$repo_dir" checkout "$highs_js_ref"
    git -C "$repo_dir" submodule update --init --recursive

    if [[ -n "$highs_tag" ]]; then
        git -C "$repo_dir/HiGHS" fetch --tags
        git -C "$repo_dir/HiGHS" checkout "$highs_tag"
    fi

    echo "Building highs.js/highs.wasm..."
    (cd "$repo_dir" && ./build.sh)

    install -m 0644 "$repo_dir/build/highs.js" "$target_dir_abs/highs.js"
    install -m 0644 "$repo_dir/build/highs.wasm" "$target_dir_abs/highs.wasm"

    echo "Updated from source:"
    echo "  highs-js ref: $(git -C "$repo_dir" rev-parse --short HEAD)"
    echo "  HiGHS ref:    $(git -C "$repo_dir/HiGHS" rev-parse --short HEAD)"
    ls -l "$target_dir_abs/highs.js" "$target_dir_abs/highs.wasm"
    sha256_file "$target_dir_abs/highs.js"
    sha256_file "$target_dir_abs/highs.wasm"

    if [[ "$keep_workdir" == "true" || "$should_clean" != "true" ]]; then
        echo "Build workdir kept at: $build_root"
    fi
}

if [[ "$mode" == "release" ]]; then
    download_release
else
    build_from_source
fi
