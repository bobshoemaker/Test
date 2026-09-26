# Where house photos can come from

Summary of research from September 2026. Terms change; re-check each source before relying
on it, and have a lawyer review the licenses. The product makes a physical derived work from
photos, so a license that covers display alone may not be enough.

## Don't use

- **Zillow, Redfin and similar portals.** Their terms prohibit automated scraping and don't
  grant rights to listing images; Redfin's also forbid commercial reuse of listing content.
  Listing photos are copyrighted, usually by the photographer, and licensed through the MLS.
- **Google Street View / Google Maps imagery.** The Maps Platform terms bar scraping,
  bulk-downloading Street View images, and creating content based on Google Maps content
  (their examples include building 3D models from imagery).

## Use

1. **Agent or homeowner uploads.** Works today. The agent usually has the listing photos;
   phone photos of the front and sides also work.
2. **MLS data feed.** MLSs license listing data (including photos) through the RESO Web API
   to vendors working with a member broker. In Southern California that's CRMLS, whose rules
   require listing photos to be licensed to CRMLS with the right to sublicense. Whether a
   vendor license covers a physical product is a contract question.
3. **Oblique aerial imagery (Nearmap, EagleView).** 45-degree views from four directions for
   most US addresses, through APIs aimed at residential properties. Good for roof shape and
   massing, softer on window detail. Enterprise contracts; pricing isn't public.
4. **Photographer platforms (Aryeo, owned by Zillow).** Aryeo has an API for listings and their
   media; with a photographer's or agent's permission it can deliver the original listing
   photos. Also a possible sales channel: photographers offer the model as an add-on.
5. **Mapillary.** Free street-level imagery under CC BY-SA 4.0 with an API. Commercial use
   is limited to specific purposes in Mapillary's terms, share-alike applies to derived
   works, and suburban coverage is patchy.

## Suggested pipeline

Address in, then try MLS feed, then aerial imagery, then Mapillary; if nothing usable comes
back, ask the agent for three photos. Every source feeds the same design loop.

## What's built (src/server/lookup.js)

- Geocoding: OpenStreetMap Nominatim, then the US Census geocoder. Nominatim's public server
  allows about one request a second, needs an identifying User-Agent (set
  `BRICKHOUSE_CONTACT`) and isn't meant for production volume; move to a self-hosted or paid
  geocoder before launch. The Census geocoder often matches only the street segment, so those
  lookups show photos from both sides of the street and the person picks.
- Photos: Mapillary only, with the person confirming which photos show the house. Credits and
  license go into the design's `photoCredits`. Panoramas are skipped for now.
- Not built: MLS feed, aerial imagery, photographer platforms. They need contracts first.
