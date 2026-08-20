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
      description:
        'The 3 plain cycling tiles in the infinite gallery wallpaper. Leave empty to use placeholder photos -- if you add any, add exactly 3 (the site falls back to placeholders otherwise).',
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
      validation: (rule) =>
        rule.custom((value) =>
          !value || value.length === 0 || value.length === 3
            ? true
            : 'Add exactly 3 (or leave empty to use placeholders)'
        ),
    }),
    defineField({
      name: 'stackImages',
      title: 'Photo stack images',
      description:
        'The 6 frames in the click-to-rotate photo stack tile. Leave empty to use placeholder photos -- if you add any, add exactly 6 (the site falls back to placeholders otherwise).',
      type: 'array',
      of: [{type: 'image'}],
      validation: (rule) =>
        rule.custom((value) =>
          !value || value.length === 0 || value.length === 6
            ? true
            : 'Add exactly 6 (or leave empty to use placeholders)'
        ),
    }),
    defineField({
      name: 'fisheyeVideo',
      title: 'Fisheye video',
      description:
        'The looping video shown through the fisheye-lens tile. Leave empty to use the placeholder video.',
      type: 'file',
      options: {accept: 'video/*'},
    }),
    defineField({
      name: 'vinylLayers',
      title: 'Vinyl reveal layers',
      description:
        'The 3 paint-to-reveal artwork layers for the vinyl record tile. Leave all 3 empty to use placeholder artwork -- the site only uses these once all 3 are filled in.',
      type: 'object',
      fields: [
        defineField({name: 'layer1', title: 'Layer 1 (base)', type: 'image'}),
        defineField({name: 'layer2', title: 'Layer 2 (revealed by painting)', type: 'image'}),
        defineField({name: 'layer3', title: 'Layer 3 (fully revealed)', type: 'image'}),
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
