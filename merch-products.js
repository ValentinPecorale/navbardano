import { createClient } from "@sanity/client";

// ---------------------------------------------------------------------
// Merch product cards -- fetched from Sanity (see /studio, `products`
// field on the `album` schema). Same fetch/fallback pattern as
// infinite-gallery.js's album content: one GROQ query for all three
// releases, merged per-category against FALLBACK_PRODUCTS so an album
// the user hasn't added products to yet (or a CMS outage) degrades to
// today's placeholder cards instead of an empty grid.
// ---------------------------------------------------------------------
const sanity = createClient({
  projectId: "9q5qedja",
  dataset: "production",
  apiVersion: "2024-01-01",
  useCdn: true,
});

const FALLBACK_PRODUCTS = {
  ehhpdsr: [
    { url: "/assets/merch/product-vinyl.webp", alt: "EHHPDSR — Vinilo", name: "EHHPDSR — Vinilo", price: "28,88 €" },
    { url: "/assets/merch/product-tee.webp", alt: "Camiseta EHHPDSR", name: "Camiseta EHHPDSR", price: "28,88 €" },
    { url: "/assets/merch/product-cd.webp", alt: "EHHPDSR — CD", name: "EHHPDSR — CD", price: "28,88 €" },
  ],
  istmo: [
    {
      url: "/assets/merch/product-vinyl.webp",
      alt: "ISTMO (4ª Edición en Vinilo)",
      name: "ISTMO (4ª Edición en Vinilo)",
      price: "28,88 €",
    },
    { url: "/assets/merch/product-tee.webp", alt: "Camiseta ISTMO", name: "Camiseta ISTMO", price: "28,88 €" },
    { url: "/assets/merch/product-cd.webp", alt: "ISTMO — CD", name: "ISTMO — CD", price: "28,88 €" },
  ],
  "nuevos-trapos": [
    {
      url: "/assets/merch/product-vinyl.webp",
      alt: "NUEVOS TRAPOS — Vinilo",
      name: "NUEVOS TRAPOS — Vinilo",
      price: "28,88 €",
    },
    {
      url: "/assets/merch/product-tee.webp",
      alt: "Camiseta NUEVOS TRAPOS",
      name: "Camiseta NUEVOS TRAPOS",
      price: "28,88 €",
    },
    { url: "/assets/merch/product-cd.webp", alt: "NUEVOS TRAPOS — CD", name: "NUEVOS TRAPOS — CD", price: "28,88 €" },
  ],
};

function mergeProducts(docs, fallback) {
  const byKey = {};
  for (const key of Object.keys(fallback)) {
    const doc = docs?.find((d) => d.slug === key);
    byKey[key] = Array.isArray(doc?.products) && doc.products.length ? doc.products : fallback[key];
  }
  return byKey;
}

async function fetchProducts() {
  try {
    const docs = await sanity.fetch(
      `*[_type == "album"]{
        "slug": slug.current,
        "products": products[]{ name, price, "url": image.asset->url, "alt": coalesce(alt, name) }
      }`
    );
    if (!docs?.some((d) => d.products?.length)) {
      console.warn("[merch-products] No products in Sanity yet -- using placeholder cards.");
    }
    return mergeProducts(docs, FALLBACK_PRODUCTS);
  } catch (err) {
    console.error("[merch-products] Failed to fetch products from Sanity -- using placeholder cards.", err);
    return FALLBACK_PRODUCTS;
  }
}

function render(productsByKey) {
  document.querySelectorAll("[data-shop-item]").forEach((item) => {
    const products = productsByKey[item.dataset.shopKey];
    const grid = item.querySelector("[data-shop-products-grid]");
    if (!products || !grid) return;
    grid.innerHTML = products
      .map(
        (p) => `
      <button type="button" class="product">
        <div class="product-image">
          <img src="${p.url}" alt="${p.alt}" />
        </div>
        <div class="product-info">
          <span class="product-name">${p.name}</span>
          <span class="product-price">${p.price}</span>
        </div>
      </button>
    `
      )
      .join("");
  });
}

const PRODUCTS = await fetchProducts();
render(PRODUCTS);
