// Creates bare "ehhpdsr" and "nuevos-trapos" album documents (title + slug
// only) so they show up in Studio ready to fill in with real content --
// the site falls back to placeholder assets for any field left empty (see
// FALLBACK_ALBUM / mergeAlbum() in ../infinite-gallery.js). Run with:
//   node seed-placeholder-albums.mjs
import {createClient} from '@sanity/client'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

function loadEnvLocal() {
  const raw = readFileSync(path.join(rootDir, '.env.local'), 'utf8')
  const env = {}
  for (const line of raw.split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/)
    if (match) env[match[1]] = match[2]
  }
  return env
}

const env = loadEnvLocal()

const client = createClient({
  projectId: env.SANITY_API_PROJECT_ID,
  dataset: env.SANITY_API_DATASET,
  token: env.SANITY_API_WRITE_TOKEN,
  apiVersion: '2024-01-01',
  useCdn: false,
})

const placeholders = [
  {_id: 'album-ehhpdsr', title: 'Ehhpdsr', slug: 'ehhpdsr'},
  {_id: 'album-nuevos-trapos', title: 'Nuevos Trapos', slug: 'nuevos-trapos'},
]

async function main() {
  for (const {_id, title, slug} of placeholders) {
    const existing = await client.getDocument(_id).catch(() => null)
    if (existing) {
      console.log(`Skipping ${_id} -- already exists.`)
      continue
    }
    await client.create({
      _id,
      _type: 'album',
      title,
      slug: {_type: 'slug', current: slug},
    })
    console.log(`Created ${_id}.`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
