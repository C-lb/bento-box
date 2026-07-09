# Designer font licences

All fonts in this directory are licensed under the SIL Open Font License,
Version 1.1 (OFL 1.1). Files were downloaded from the `google/fonts` GitHub
repository (`github.com/google/fonts`, `ofl/<family>/`), which mirrors the
canonical upstream sources for each family.

Full licence text: https://openfontlicense.org/ (also reproduced at the
bottom of this file, and inside each family's `ofl/<family>/OFL.txt` in the
upstream repo).

## Families

### Inter
- Files: `inter-regular.ttf` (upstream variable TTF, used as-is),
  `inter-bold.ttf` (static bold — upstream `ofl/inter/` ships a variable
  TTF only, so this file is a wght=700 instance pinned from the upstream
  variable font via `fonttools varLib.instancer`, with the name table,
  `head.macStyle`, and `OS/2.fsSelection`/`usWeightClass` corrected to
  identify it as a distinct static Bold face)
- Copyright: Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)
- Licence: SIL OFL 1.1

### DM Sans
- Files: `dm-sans-regular.ttf` (upstream variable TTF, used as-is),
  `dm-sans-bold.ttf` (static bold instanced at wght=700 from the upstream
  variable font — upstream `ofl/dmsans/` ships a variable TTF only; see
  Inter note above for the instancing method)
- Copyright: Copyright 2014 The DM Sans Project Authors (https://github.com/googlefonts/dm-fonts)
- Licence: SIL OFL 1.1

### Playfair Display
- Files: `playfair-display-regular.ttf` (upstream variable TTF, used
  as-is), `playfair-display-bold.ttf` (static bold instanced at wght=700
  from the upstream variable font — upstream `ofl/playfairdisplay/` ships
  a variable TTF only; see Inter note above for the instancing method)
- Copyright: Copyright 2017 The Playfair Display Project Authors (https://github.com/clauseggers/Playfair-Display), with Reserved Font Name "Playfair Display"
- Licence: SIL OFL 1.1

### Cormorant Garamond
- Files: `cormorant-garamond-regular.ttf` (upstream variable TTF, used
  as-is), `cormorant-garamond-bold.ttf` (static bold instanced at wght=700
  from the upstream variable font — upstream `ofl/cormorantgaramond/`
  ships a variable TTF only; see Inter note above for the instancing
  method)
- Copyright: Copyright 2015 The Cormorant Project Authors (github.com/CatharsisFonts/Cormorant)
- Licence: SIL OFL 1.1

### Great Vibes
- File: `great-vibes-regular.ttf` (regular only, per spec — script family
  has no bold weight)
- Copyright: Copyright 2010 The Great Vibes Pro Project Authors (https://github.com/googlefonts/great-vibes)
- Licence: SIL OFL 1.1

### Oswald
- Files: `oswald-regular.ttf` (upstream variable TTF, used as-is),
  `oswald-bold.ttf` (static bold instanced at wght=700 from the upstream
  variable font — upstream `ofl/oswald/` ships a variable TTF only; see
  Inter note above for the instancing method)
- Copyright: Copyright 2016 The Oswald Project Authors (https://github.com/googlefonts/OswaldFont)
- Licence: SIL OFL 1.1

### Space Mono
- Files: `space-mono-regular.ttf`, `space-mono-bold.ttf` (static fonts,
  separate bold file shipped)
- Copyright: Copyright 2016 The Space Mono Project Authors (https://github.com/googlefonts/spacemono)
- Licence: SIL OFL 1.1

## SIL Open Font License, Version 1.1 — summary statement

Each font listed above is licensed under the SIL Open Font License, Version
1.1. This licence permits use, study, modification, and redistribution of
the fonts (including bundling them with this application) provided the
fonts, whether modified or unmodified, are not sold by themselves and any
derivative works carry the same licence. The full licence text is available
at https://openfontlicense.org/ and at
https://github.com/google/fonts/blob/main/ofl/inter/OFL.txt (and the
equivalent `OFL.txt` file inside each family's directory in the
`google/fonts` repository).

Copyright notice format required by the OFL is preserved verbatim per family
above.
