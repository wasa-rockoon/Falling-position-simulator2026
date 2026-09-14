# License and source notices

The JavaScript ports of the Tawhiri numerical algorithms are distributed under
GPL-3.0-or-later, retaining attribution to Adam Greig and Daniel Richman (2014).
The original source files extracted from the pinned image are in reference-source/.
The GPL text is in reference-source/LICENSE.
Project: https://github.com/projecthorus/tawhiri

The terrain sampling algorithm follows Ruaumoko (Copyright 2014 Adam Greig,
Daniel Richman; GPL-3.0-or-later).
Source: https://github.com/cuspaceflight/ruaumoko
The reference executes the image's original compiled Ruaumoko module.
It was not replaced by the JavaScript sampler.

Weather: NOAA/NWS GFS. This is processed research data, not an official NOAA
prediction or endorsement. Exact source requests, run, forecast hours and hashes
are in fixtures/manifest.json and fixtures/source/sources.json.
Terms: https://www.weather.gov/disclaimer/

Terrain: Viewfinder Panoramas, Jonathan de Ferranti.
https://www.viewfinderpanoramas.org/dem3.html
Terms: https://www.viewfinderpanoramas.org/
The regional fixture is cropped and reformatted from the existing local
Ruaumoko dataset for this research comparison. Its upstream release date is
unknown; its exact bytes are identified by SHA-256. Source credit and links
are retained because the original global format cannot be used directly
in this small browser fixture. Do not describe this dataset as NOAA data
or as GPL solely because the Ruaumoko software is GPL.

No native binaries or Docker images are redistributed in this PoC.
