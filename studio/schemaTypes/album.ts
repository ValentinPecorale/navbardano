import {defineField, defineType} from 'sanity'

export const album = defineType({
  name: 'album',
  title: 'Album',
  type: 'document',
  fields: [
    defineField({
      name: 'title',
      title: 'Title',
      type: 'string',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: {source: 'title'},
      description: 'Controls the page URL: /albums/<slug>. The album with slug "istmo" also serves as the site homepage.',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'songs',
      title: 'Songs',
      type: 'array',
      of: [
        defineField({
          name: 'song',
          title: 'Song',
          type: 'object',
          fields: [
            defineField({name: 'number', title: 'Number', type: 'string', validation: (rule) => rule.required()}),
            defineField({name: 'title', title: 'Title', type: 'string', validation: (rule) => rule.required()}),
          ],
          preview: {
            select: {number: 'number', title: 'title'},
            prepare({number, title}) {
              return {title: `${number} — ${title}`}
            },
          },
        }),
      ],
    }),
    defineField({
      name: 'songDescription',
      title: 'Song collection description',
      type: 'text',
      rows: 4,
    }),
    defineField({
      name: 'wallpaperPhotos',
      title: 'Wallpaper photos',
      description: 'The 3 plain cycling tiles in the infinite gallery wallpaper.',
      type: 'array',
      of: [
        defineField({
          name: 'wallpaperPhoto',
          title: 'Wallpaper photo',
          type: 'object',
          fields: [
            defineField({name: 'image', title: 'Image', type: 'image', validation: (rule) => rule.required()}),
            defineField({name: 'caption', title: 'Caption', type: 'string'}),
          ],
          preview: {
            select: {media: 'image', title: 'caption'},
          },
        }),
      ],
      validation: (rule) => rule.length(3),
    }),
    defineField({
      name: 'stackImages',
      title: 'Photo stack images',
      description: 'The 6 frames in the click-to-rotate photo stack tile.',
      type: 'array',
      of: [{type: 'image'}],
      validation: (rule) => rule.length(6),
    }),
    defineField({
      name: 'fisheyeVideo',
      title: 'Fisheye video',
      description: 'The looping video shown through the fisheye-lens tile.',
      type: 'file',
      options: {accept: 'video/*'},
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'vinylLayers',
      title: 'Vinyl reveal layers',
      description: 'The 3 paint-to-reveal artwork layers for the vinyl record tile.',
      type: 'object',
      fields: [
        defineField({name: 'layer1', title: 'Layer 1 (base)', type: 'image', validation: (rule) => rule.required()}),
        defineField({name: 'layer2', title: 'Layer 2 (revealed by painting)', type: 'image', validation: (rule) => rule.required()}),
        defineField({name: 'layer3', title: 'Layer 3 (fully revealed)', type: 'image', validation: (rule) => rule.required()}),
      ],
    }),
  ],
  preview: {
    select: {title: 'title', subtitle: 'slug.current'},
    prepare({title, subtitle}) {
      return {title, subtitle: subtitle ? `/albums/${subtitle}` : undefined}
    },
  },
})
