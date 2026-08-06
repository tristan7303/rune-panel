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
import mark from './assets/mark.png'
import profileLogo from './assets/logo.png'

interface Card {
  route: Route
  title: string
  blurb: string
  /** Wiki filename, served through the local image cache. */
  image?: string
  /** A bundled asset instead, for anything the wiki has no art for. */
  asset?: string
}

const CARDS: Card[] = [
  {
    route: { kind: 'tool', id: 'dps' },
    title: 'DPS calculator',
    blurb: "The wiki's own, for testing a loadout against any monster.",
    image: 'Dragon_scimitar.png',
  },
  {
    route: { kind: 'ge' },
    title: 'Grand Exchange',
    blurb: 'Live buy and sell prices, margins after tax, and a year of history.',
    image: 'Coins_10000.png',
  },
  {
    route: { kind: 'hiscores' },
    title: 'Hiscores',
    blurb: 'Look up an account and compare it against your own.',
    image: 'HiScores_icon.png',
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
  },
  {
    route: { kind: 'page', title: 'Old School RuneScape Wiki' },
    title: 'Browse the wiki',
    blurb: 'Every article and alias, cached locally after the first read.',
    image: 'Book_of_knowledge.png',
  },
]

export function Home(): JSX.Element {
  const push = useNav((s) => s.push)

  return (
    <div className="home">
      <header className="home-hero">
        <img className="home-mark" src={mark} alt="Rune Panel" draggable={false} />
        <h1>Rune Panel</h1>
        <p>
          The whole wiki, a keystroke away — plus prices, calculators and profiles. Press{' '}
          <kbd>Ctrl</kbd> <kbd>F</kbd> to search from anywhere.
        </p>
      </header>

      <div className="home-cards">
        {CARDS.map((card) => (
          <button key={card.title} className="home-card" onClick={() => push(card.route)}>
            <span className="home-card-art">
              {/* Straight to the cache protocol: main downloads it on first use
                  and serves it from disk after. A miss simply renders nothing,
                  which is why the tile has its own background. */}
              <img
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
