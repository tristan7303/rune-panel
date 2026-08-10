/**
 * Home.
 *
 * What the app opens to, and what the mark in the rail returns you to. Search
 * itself lives in the header now, so this is not a search page — it is the
 * answer to "what can this do", which is worth stating once rather than leaving
 * you to click six unlabelled icons and find out.
 *
 * The card art comes from the wiki through the same local image cache the
 * articles use, so it costs one download each and then nothing.
 */

import type { JSX } from 'react'
import { useNav, type Route } from './nav'
import { useStore } from './store'
import mark from './assets/mark.png'
import profileLogo from './assets/logo.png'
import geTrackerLogo from './assets/ge-tracker-logo-small.png'

interface Card {
  route: Route
  title: string
  blurb: string
  /** Wiki filename, served through the local image cache. */
  image?: string
  /** A bundled asset instead, for anything the wiki has no art for. */
  asset?: string
  /**
   * Blow the sprite up to fill the art box. Wiki sprites render at their own
   * size, which is right for items — but the interface icons are drawn small,
   * and at natural size they rattle around in the tile.
   */
  zoom?: boolean
}

/**
 * The prices tile follows the setting, exactly as the rail does.
 *
 * Only one of the two is ever offered. They answer the same question, and a
 * home screen listing both invites the reader to work out which one this app
 * actually means.
 */
function pricesCard(geTracker: boolean): Card {
  return geTracker
    ? {
        route: { kind: 'tool', id: 'getracker' },
        title: 'GE Tracker',
        blurb: 'Live margins, volume and price history, with the items you star kept to hand.',
        // Their own mark, for the same reason RuneProfile carries its own: the
        // coin sprite belongs to the built-in Grand Exchange this card replaces,
        // and using it for both leaves the two tiles indistinguishable.
        asset: geTrackerLogo,
      }
    : {
        route: { kind: 'ge' },
        title: 'Grand Exchange',
        blurb: 'Live buy and sell prices, margins after tax, and a year of history.',
        image: 'Coins_10000.png',
      }
}

function cards(geTracker: boolean): Card[] {
  return [
  {
    route: { kind: 'tool', id: 'dps' },
    title: 'DPS calculator',
    blurb: "The wiki's own, for testing a loadout against any monster.",
    image: 'Dragon_scimitar.png',
  },
  pricesCard(geTracker),
  {
    route: { kind: 'hiscores' },
    title: 'Hiscores',
    blurb: 'Look up an account and compare it against your own.',
    image: 'HiScores_icon.png',
    zoom: true,
  },
  {
    route: { kind: 'tool', id: 'profile' },
    title: 'RuneProfile',
    blurb: 'Skills, quests, diaries, combat achievements and the collection log.',
    // Their own mark: this card leads to a different product, and should look
    // like it rather than borrowing a wiki sprite.
    asset: profileLogo,
  },
  {
    route: { kind: 'tool', id: 'calculators' },
    title: 'Calculators',
    blurb: 'Skill calculators, live from the wiki so they always match the game.',
    image: 'Smithing_icon.png',
    zoom: true,
  },
  {
    route: { kind: 'notes' },
    title: 'Notes',
    blurb: 'Pages for gear, routes and to-dos, saved as you type.',
    // The Barbarian Training journal — the one item in the game actually
    // called "My notes".
    image: 'My_notes.png',
  },
  ]
}

export function Home(): JSX.Element {
  const push = useNav((s) => s.push)
  const geTracker = useStore((s) => s.settings?.geTrackerReplacesGe ?? true)

  return (
    <div className="home">
      <header className="home-hero">
        {/* The mark carries the name already; a heading under it just repeats it. */}
        <img className="home-mark" src={mark} alt="Rune Panel" draggable={false} />
        <p>
          The whole wiki, a keystroke away — plus prices, calculators and profiles. Press{' '}
          <kbd>Ctrl</kbd> <kbd>F</kbd> to search from anywhere.
        </p>
      </header>

      <div className="home-cards">
        {cards(geTracker).map((card) => (
          <button key={card.title} className="home-card" onClick={() => push(card.route)}>
            <span className="home-card-art">
              {/* Straight to the cache protocol: main downloads it on first use
                  and serves it from disk after. A miss simply renders nothing,
                  which is why the tile has its own background. */}
              <img
                // A bundled asset is a logo and wants smooth downscaling; a
                // wiki filename is pixel art and wants none.
                className={
                  [card.asset && 'is-logo', card.zoom && 'is-zoomed'].filter(Boolean).join(' ') ||
                  undefined
                }
                src={card.asset ?? `rpimg://img/${card.image ?? ''}`}
                alt=""
                loading="lazy"
                draggable={false}
              />
            </span>
            <span className="home-card-text">
              <strong>{card.title}</strong>
              <em>{card.blurb}</em>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
