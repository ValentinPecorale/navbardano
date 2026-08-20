// One-off seed script: creates/updates the "istmo" album document with the
// content currently hardcoded in ../index.html and ../infinite-gallery.js,
// so the site can be migrated to fetch from Sanity instead. Run with:
//   node seed-istmo.mjs
// Requires SANITY_API_WRITE_TOKEN in ../.env.local (already provisioned by
// the Vercel Sanity integration).
import {createClient} from '@sanity/client'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

function loadEnvLocal() {
  const envPath = path.join(rootDir, '.env.local')
  const raw = readFileSync(envPath, 'utf8')
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

async function uploadImageFromUrl(url, filename) {
  const res = await fetch(url)
  const buffer = Buffer.from(await res.arrayBuffer())
  const asset = await client.assets.upload('image', buffer, {filename})
  return {_type: 'image', asset: {_type: 'reference', _ref: asset._id}}
}

async function uploadImageFromFile(relPath) {
  const buffer = readFileSync(path.join(rootDir, relPath))
  const asset = await client.assets.upload('image', buffer, {filename: path.basename(relPath)})
  return {_type: 'image', asset: {_type: 'reference', _ref: asset._id}}
}

async function uploadFileFromFile(relPath, contentType) {
  const buffer = readFileSync(path.join(rootDir, relPath))
  const asset = await client.assets.upload('file', buffer, {
    filename: path.basename(relPath),
    contentType,
  })
  return {_type: 'file', asset: {_type: 'reference', _ref: asset._id}}
}

async function main() {
  console.log('Uploading vinyl reveal layers...')
  const layer1 = await uploadImageFromFile('assets/vinyl/reveal-layer1.png')
  const layer2 = await uploadImageFromFile('assets/vinyl/reveal-layer2.png')
  const layer3 = await uploadImageFromFile('assets/vinyl/reveal-layer3.png')

  console.log('Uploading fisheye video...')
  const fisheyeVideo = await uploadFileFromFile('video/gallery-video.mp4', 'video/mp4')

  console.log('Uploading stack images (placeholders)...')
  const stackImages = []
  for (let i = 1; i <= 6; i++) {
    const url = `https://picsum.photos/seed/infinite-gallery-stack-${i}/700/900`
    stackImages.push(await uploadImageFromUrl(url, `stack-${i}.jpg`))
  }

  console.log('Uploading wallpaper photos (placeholders)...')
  const wallpaperPhotos = []
  for (let i = 0; i < 3; i++) {
    const seed = i + 2
    const url = `https://picsum.photos/seed/infinite-gallery-${seed}/700/900`
    const image = await uploadImageFromUrl(url, `wallpaper-${seed}.jpg`)
    wallpaperPhotos.push({
      _type: 'wallpaperPhoto',
      _key: `wallpaper-${seed}`,
      image,
      caption: `Project ${String(seed).padStart(2, '0')}`,
    })
  }

  const doc = {
    _id: 'album-istmo',
    _type: 'album',
    title: 'Istmo',
    slug: {_type: 'slug', current: 'istmo'},
    songs: [
      {_type: 'song', _key: 'song-1', number: '01', title: 'NOTORIO, FEAT DUKI, LIL SUPA.'},
      {_type: 'song', _key: 'song-2', number: '02', title: 'NOTORIO, FEAT DUKI, LIL SUPA.'},
      {_type: 'song', _key: 'song-3', number: '03', title: 'NOTORIO, FEAT DUKI, LIL SUPA.'},
    ],
    songDescription:
      'Lorem ipsum dolor sit amet consectetur adipiscing elit Ut et massa mi. Aliquam in hendrerit urna. Pellentesque sit amet sapien.Lorem ipsum dolor sit amet consectetur adipiscing elit Ut et massa mi. Aliquam in hendrerit urna. Pellentesque sit amet sapien.Lorem ipsum dolor sit amet consectetur adipiscing elit Ut et massa mi. Aliquam in hendrerit urna. Pellentesque sit amet sapien.Lorem ipsum dolor sit amet consectetur adipiscing elit Ut et massa mi. Aliquam in hendrerit urna. Pellentesque sit amet sapien.',
    wallpaperPhotos,
    stackImages: stackImages.map((img, i) => ({...img, _key: `stack-${i + 1}`})),
    fisheyeVideo,
    vinylLayers: {
      layer1,
      layer2,
      layer3,
    },
  }

  console.log('Writing album-istmo document...')
  await client.createOrReplace(doc)
  console.log('Done. Seeded "istmo" album:', doc._id)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
