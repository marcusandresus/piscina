#!/usr/bin/env python3
"""Build a multi-size favicon.ico from PNG files.

Default behavior:
- Reads PNG files from public/icons matching icon-*.png.
- Keeps only square icons up to 256x256 (ICO directory limit).
- Sorts sizes descending (largest first), for legacy compatibility habits.
- Writes public/icons/favicon.ico.
"""

from __future__ import annotations

import argparse
import glob
import os
import struct
import sys
from dataclasses import dataclass
from typing import Iterable

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
DEFAULT_ICO_SIZES_DESC = [256, 128, 64, 48, 32, 24, 16]


@dataclass(frozen=True)
class PngIcon:
    path: str
    size: int
    data: bytes


def read_png(path: str) -> PngIcon:
    with open(path, "rb") as fh:
        data = fh.read()

    if len(data) < 33 or not data.startswith(PNG_SIGNATURE):
        raise ValueError(f"{path}: not a valid PNG file")

    ihdr_len = struct.unpack(">I", data[8:12])[0]
    ihdr_type = data[12:16]
    if ihdr_type != b"IHDR" or ihdr_len < 8:
        raise ValueError(f"{path}: invalid IHDR chunk")

    width = struct.unpack(">I", data[16:20])[0]
    height = struct.unpack(">I", data[20:24])[0]

    if width != height:
        raise ValueError(f"{path}: icon must be square, got {width}x{height}")
    if width == 0:
        raise ValueError(f"{path}: invalid icon size 0x0")

    return PngIcon(path=path, size=width, data=data)


def discover_pngs(icons_dir: str, explicit_inputs: list[str] | None) -> list[str]:
    if explicit_inputs:
        return explicit_inputs
    pattern = os.path.join(icons_dir, "icon-*.png")
    return sorted(glob.glob(pattern))


def parse_sizes(raw: str | None) -> set[int] | None:
    if not raw:
        return None
    sizes: set[int] = set()
    for token in raw.split(","):
        token = token.strip()
        if not token:
            continue
        try:
            value = int(token)
        except ValueError as exc:
            raise ValueError(f"invalid size value: {token!r}") from exc
        if value <= 0:
            raise ValueError(f"size must be > 0: {value}")
        sizes.add(value)
    if not sizes:
        raise ValueError("at least one size must be provided with --sizes")
    return sizes


def filter_icons(
    icons: Iterable[PngIcon],
    include_sizes: set[int] | None,
    max_size: int,
) -> list[PngIcon]:
    result: list[PngIcon] = []
    for icon in icons:
        if icon.size > max_size:
            continue
        if include_sizes is not None and icon.size not in include_sizes:
            continue
        result.append(icon)
    if not result:
        raise ValueError("no icons left after filtering")
    return result


def unique_by_size(icons: Iterable[PngIcon]) -> list[PngIcon]:
    by_size: dict[int, PngIcon] = {}
    for icon in icons:
        # Last wins if duplicate sizes are provided.
        by_size[icon.size] = icon
    return list(by_size.values())


def sort_icons(icons: list[PngIcon], order: str) -> list[PngIcon]:
    reverse = order == "desc"
    return sorted(icons, key=lambda icon: icon.size, reverse=reverse)


def ico_size_byte(size: int) -> int:
    # ICO directory stores 256 as 0.
    if size == 256:
        return 0
    return size


def build_ico(icons: list[PngIcon]) -> bytes:
    if len(icons) > 65535:
        raise ValueError("too many icons for ICO format")

    header = struct.pack("<HHH", 0, 1, len(icons))
    entries = bytearray()
    image_data = bytearray()

    offset = 6 + 16 * len(icons)
    for icon in icons:
        if icon.size > 256:
            raise ValueError(
                f"{icon.path}: {icon.size}x{icon.size} cannot be stored in ICO directory"
            )
        width = ico_size_byte(icon.size)
        height = ico_size_byte(icon.size)
        bytes_in_res = len(icon.data)
        entry = struct.pack(
            "<BBBBHHII",
            width,
            height,
            0,  # palette colors
            0,  # reserved
            1,  # color planes
            32,  # bits per pixel
            bytes_in_res,
            offset,
        )
        entries.extend(entry)
        image_data.extend(icon.data)
        offset += bytes_in_res

    return header + entries + image_data


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build favicon.ico from PNG icons."
    )
    parser.add_argument(
        "--icons-dir",
        default="public/icons",
        help="Directory containing PNG icons (default: public/icons).",
    )
    parser.add_argument(
        "--output",
        default="public/icons/favicon.ico",
        help="Output ICO path (default: public/icons/favicon.ico).",
    )
    parser.add_argument(
        "--inputs",
        nargs="*",
        help="Explicit PNG files to include. If omitted, uses icon-*.png in icons-dir.",
    )
    parser.add_argument(
        "--sizes",
        help="Comma-separated sizes to include, e.g. 256,128,64,48,32,16.",
    )
    parser.add_argument(
        "--order",
        choices=["desc", "asc"],
        default="desc",
        help="Directory entry order in ICO (default: desc).",
    )
    parser.add_argument(
        "--max-size",
        type=int,
        default=256,
        help="Maximum icon size to include (default: 256).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        include_sizes = parse_sizes(args.sizes)
        png_paths = discover_pngs(args.icons_dir, args.inputs)
        if not png_paths:
            raise ValueError("no PNG files found")

        icons = [read_png(path) for path in png_paths]
        if include_sizes is None and not args.inputs:
            # Prefer classic ICO sizes for broad/legacy compatibility.
            discovered_sizes = {icon.size for icon in icons}
            preferred = [size for size in DEFAULT_ICO_SIZES_DESC if size in discovered_sizes]
            if preferred:
                include_sizes = set(preferred)

        icons = filter_icons(icons, include_sizes=include_sizes, max_size=args.max_size)
        icons = unique_by_size(icons)
        icons = sort_icons(icons, order=args.order)
        ico_bytes = build_ico(icons)
    except Exception as exc:  # noqa: BLE001
        print(f"error: {exc}", file=sys.stderr)
        return 1

    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    with open(args.output, "wb") as out:
        out.write(ico_bytes)

    sizes = ", ".join(str(icon.size) for icon in icons)
    print(f"Wrote {args.output} with {len(icons)} images: {sizes}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
