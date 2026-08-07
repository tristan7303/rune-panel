/**
 * Artwork for the hiscores. The API gives names, not pictures.
 *
 * Two sources, one each, for reasons particular to each. Skills come from the
 * wiki, where the icons are the familiar ones and follow a single naming
 * convention. Activities come from the hiscores' own CDN, because Jagex draws
 * its own boss icons and they are not the wiki's images.
 *
 * Both load through `rpimg://`, the same cache the article renderer uses, so a
 * second lookup paints from disk and a skill icon already pulled in by an
 * article is never downloaded twice.
 *
 * Neither naming rule is a guess. Both were checked against the source — the
 * wiki through `action=query&prop=imageinfo`, the hiscores against the icon
 * list its own pages ship — and then fetched to confirm a 200 and an image
 * content type. Guessing produces a page of broken icons that each look like a
 * bug.
 */

/** Skill icons follow one convention exactly, all 24 of them: "<Name> icon.png". */
export function skillIcon(skill: string): string {
  return wikiImage(`${skill} icon.png`)
}

/**
 * Boss and activity icons, from the hiscores themselves.
 *
 * Not the wiki. The hiscores draw their own artwork and it is different — a
 * tight icon where the wiki has a full monster render, and the one people
 * already associate with a kill count. Several also have no clean wiki
 * equivalent at all: a raid is a place, not a creature, so the wiki's nearest
 * offering is the pet.
 *
 * The file name is derived, not mapped. Jagex slugs the activity name by
 * lowercasing it and dropping everything that is not a letter or digit, and
 * that single rule reproduces all ninety-one exactly — apostrophes
 * (`Calvar'ion`), colons (`Chambers of Xeric: Challenge Mode`), hyphens
 * (`TzKal-Zuk`) and brackets (`Clue Scrolls (all)`) included. Verified against
 * the list the hiscores page itself ships, then fetched to confirm each one
 * serves an image. A forty-line lookup table would have said the same thing
 * and gone stale on the next boss release; this one already knows about it.
 */
export function activityIcon(activity: string): string {
  const slug = activity.toLowerCase().replace(/[^a-z0-9]/g, '')
  return `rpimg://hs/game_icon_${slug}.png`
}

/**
 * A wiki file name as a cache URL.
 *
 * Underscores because that is what MediaWiki canonicalises spaces to, and
 * per-segment encoding for the apostrophes and brackets that several of these
 * carry — `Kree'arra`, `Chest (Barrows)`.
 */
function wikiImage(file: string): string {
  return `rpimg://img/${encodeURIComponent(file.replace(/ /g, '_'))}`
}
