#!/usr/bin/env python3
"""Klargjør produktbilder for nettside/bilder/.

Skalerer/beskjærer, konverterer format, komprimerer, og kan fjerne bakgrunn lokalt (rembg).
Skriver ALLTID til en egen output-fil/mappe - rører aldri originalbilder.

Eksempler:
  python scripts/bilde_klargjor.py nettside/bilder/kia-ev9/foo.jpg --max-dim 1600
  python scripts/bilde_klargjor.py nettside/bilder/kia-ev9 --format webp --quality 80
  python scripts/bilde_klargjor.py bilde.jpg --rembg
  python scripts/bilde_klargjor.py nettside/bilder/kia-ev9 --rapporter-rot
"""

import argparse
import re
import sys
import unicodedata
from pathlib import Path

from PIL import Image, ImageOps

BILDEFORMATER = {".jpg", ".jpeg", ".png", ".webp"}

TRANSLITTERASJON = str.maketrans({
    "æ": "ae", "ø": "o", "å": "a",
    "Æ": "AE", "Ø": "O", "Å": "A",
})


def rydd_filnavn_stamme(stamme: str) -> str:
    stamme = stamme.translate(TRANSLITTERASJON)
    stamme = unicodedata.normalize("NFKD", stamme).encode("ascii", "ignore").decode("ascii")
    stamme = re.sub(r"[^a-zA-Z0-9]+", "-", stamme).strip("-").lower()
    return stamme or "bilde"


def skaler_cover(img: Image.Image, bredde: int, hoyde: int) -> Image.Image:
    kilde_ratio = img.width / img.height
    mal_ratio = bredde / hoyde
    if kilde_ratio > mal_ratio:
        ny_hoyde, ny_bredde = hoyde, round(hoyde * kilde_ratio)
    else:
        ny_bredde, ny_hoyde = bredde, round(bredde / kilde_ratio)
    img = img.resize((ny_bredde, ny_hoyde), Image.Resampling.LANCZOS)
    venstre = (ny_bredde - bredde) // 2
    topp = (ny_hoyde - hoyde) // 2
    return img.crop((venstre, topp, venstre + bredde, topp + hoyde))


def skaler_maks(img: Image.Image, maks_dim: int) -> Image.Image:
    img = img.copy()
    img.thumbnail((maks_dim, maks_dim), Image.Resampling.LANCZOS)
    return img


def fjern_bakgrunn(img: Image.Image) -> Image.Image:
    try:
        from rembg import remove
    except ImportError:
        sys.exit(
            "FEIL: rembg er ikke installert. Kjør: pip install rembg onnxruntime\n"
            "(Hvis installasjonen feiler pga. Python-versjon: ikke anta at bakgrunnsfjerning "
            "virker - meld fra om feilen i stedet.)"
        )
    return remove(img)


def prosesser_fil(sti: Path, ut_mappe: Path, args, tvungent_suffiks: str = "") -> Path:
    img = Image.open(sti)
    img = ImageOps.exif_transpose(img)

    if args.rembg:
        img = fjern_bakgrunn(img)

    if args.resize:
        img = skaler_cover(img, *args.resize)
    elif args.max_dim:
        img = skaler_maks(img, args.max_dim)

    format_ut = args.format
    if args.rembg and format_ut in (None, "jpg", "jpeg"):
        if format_ut:
            print(
                f"NB: {sti.name} - JPG støtter ikke transparens fra bakgrunnsfjerning, "
                "lagrer som PNG i stedet.",
                file=sys.stderr,
            )
        format_ut = "png"
    if not format_ut:
        format_ut = sti.suffix.lstrip(".").lower() or "jpg"
    if format_ut == "jpeg":
        format_ut = "jpg"

    navn_stamme = Path(sti.name).stem
    if args.rename_clean:
        navn_stamme = rydd_filnavn_stamme(navn_stamme)
    ut_sti = ut_mappe / f"{navn_stamme}{tvungent_suffiks}.{format_ut}"

    pillow_format = {"jpg": "JPEG", "png": "PNG", "webp": "WEBP"}[format_ut]
    lagre_kwargs = {}
    if pillow_format == "JPEG":
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
            bakgrunn = Image.new("RGB", img.size, "white")
            bakgrunn.paste(img, mask=img.split()[-1])
            img = bakgrunn
        elif img.mode != "RGB":
            img = img.convert("RGB")
        lagre_kwargs.update(quality=args.quality, optimize=True)
    elif pillow_format == "WEBP":
        lagre_kwargs.update(quality=args.quality)
    else:
        lagre_kwargs.update(optimize=True)

    ut_mappe.mkdir(parents=True, exist_ok=True)
    img.save(ut_sti, pillow_format, **lagre_kwargs)
    return ut_sti


def rapporter_rot(mappe: Path) -> None:
    thumbs = sorted(mappe.rglob("Thumbs.db"))
    kopier = sorted(p for p in mappe.rglob("*") if p.is_file() and "kopi" in p.stem.lower())
    if not thumbs and not kopier:
        print('Ingen åpenbar rot funnet (ingen Thumbs.db eller "kopi"-filer).')
        return
    if thumbs:
        print(f"Thumbs.db-filer ({len(thumbs)}) - trygge å slette:")
        for p in thumbs:
            print(f"  {p}")
    if kopier:
        print(f'\nMulige duplikater ("kopi" i filnavnet) ({len(kopier)}) - sjekk selv før sletting:')
        for p in kopier:
            print(f"  {p}  ({p.stat().st_size:,} bytes)")
    print("\nDette scriptet sletter ingenting selv - vurder og slett manuelt.")


def parse_resize(verdi: str) -> tuple[int, int]:
    try:
        bredde, hoyde = (int(x) for x in verdi.lower().split("x"))
        return bredde, hoyde
    except ValueError:
        raise argparse.ArgumentTypeError("må være i formatet BREDDExHØYDE, f.eks. 800x600")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", type=Path, nargs="?", help="Bildefil eller mappe")
    parser.add_argument("-o", "--output", type=Path, help="Output-mappe (standard: <input>_klargjort ved siden av input)")
    parser.add_argument("--max-dim", type=int, help="Skaler ned så lengste side er maks N piksler (aldri opp)")
    parser.add_argument("--resize", type=parse_resize, help="Skaler+beskjær til nøyaktig BREDDExHØYDE, f.eks. 800x600")
    parser.add_argument("--format", choices=["jpg", "jpeg", "png", "webp"], help="Konverter til dette formatet (standard: behold originalformat)")
    parser.add_argument("--quality", type=int, default=85, help="JPEG/WEBP-kvalitet 1-95 (standard 85)")
    parser.add_argument("--rembg", action="store_true", help="Fjern bakgrunn lokalt (rembg) - lagres som PNG med transparens med mindre --format overstyrer")
    parser.add_argument("--rename-clean", action="store_true", help="Rydd filnavn i output (mellomrom/norske tegn -> trygge ascii-navn)")
    parser.add_argument("--rapporter-rot", action="store_true", help="Kun rapporter Thumbs.db og mulige duplikater i input-mappen (leser, endrer/sletter ingenting)")
    args = parser.parse_args()

    if args.rapporter_rot:
        if not args.input or not args.input.is_dir():
            parser.error("--rapporter-rot krever en mappe som input")
        rapporter_rot(args.input)
        return

    if not args.input:
        parser.error("input (fil eller mappe) er påkrevd med mindre --rapporter-rot brukes")
    if not args.input.exists():
        parser.error(f"finner ikke {args.input}")

    if args.input.is_file():
        ut_mappe = args.output or args.input.parent
        ut_sti = prosesser_fil(args.input, ut_mappe, args, tvungent_suffiks="_klargjort")
        print(f"Skrev {ut_sti}")
        return

    ut_mappe_rot = args.output or args.input.parent / f"{args.input.name}_klargjort"
    if ut_mappe_rot.resolve() == args.input.resolve() or ut_mappe_rot.resolve().is_relative_to(args.input.resolve()):
        parser.error("output-mappen kan ikke være inni input-mappen - originalene skal aldri kunne overskrives")

    filer = [p for p in args.input.rglob("*") if p.is_file() and p.suffix.lower() in BILDEFORMATER]
    if not filer:
        sys.exit("Fant ingen bildefiler å prosessere.")

    print(f"Prosesserer {len(filer)} bilde(r) -> {ut_mappe_rot}")
    feil = 0
    for fil in filer:
        relativ_mappe = fil.relative_to(args.input).parent
        ut_mappe = ut_mappe_rot / relativ_mappe
        try:
            ut_sti = prosesser_fil(fil, ut_mappe, args)
            print(f"  OK   {fil.relative_to(args.input)} -> {ut_sti.relative_to(ut_mappe_rot)}")
        except Exception as e:
            feil += 1
            print(f"  FEIL {fil.relative_to(args.input)}: {e}", file=sys.stderr)
    if feil:
        sys.exit(f"{feil} av {len(filer)} bilde(r) feilet.")


if __name__ == "__main__":
    main()
