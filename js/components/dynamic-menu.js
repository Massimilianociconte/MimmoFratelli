/**
 * Dynamic Menu Component
 * Avenue M. E-commerce Platform
 * 
 * Dynamically populates navigation menu subcategories from DB,
 * keeping the menu in sync with CMS-managed categories.
 */

import { supabase, isSupabaseConfigured } from '../supabase.js';

// Category icon mapping (must match CMS getCategoryIcon)
const CATEGORY_ICONS = {
    // Frutta
    'frutta-fresca': '🍎',
    'agrumi': '🍊',
    'frutta-secca': '🥜',
    'frutta-disidratata': '🍇',
    'frutta-esotica': '🥭',
    'frutta-biologica': '🌱',
    // Verdura
    'verdura-fresca': '🥬',
    'ortaggi': '🥕',
    'insalate': '🥗',
    'insalate-pronte': '🥗',
    'verdura-biologica': '🌿',
    'legumi-freschi': '🫛',
    'erbe-aromatiche': '🌿',
    // Conserve e Preparati
    'sottoli': '🫙',
    'olive-sottoli': '🫒',
    'sottaceti': '🥒',
    'marmellate-confetture': '🍯',
    'salse-sughi': '🍝',
    'conserve-pomodoro': '🍅',
    'piatti-pronti': '🍲',
    'contorni': '🥘',
    // Prodotti Secchi e Estratti
    'oli': '🫒',
    'succhi-spremute': '🧃',
    'legumi-secchi': '🫘',
    'spezie-aromi': '🧂',
    'farine-cereali': '🌾',
    // Altri
    'cassette-miste': '📦',
    'formaggi': '🧀',
    'salumi': '🥓'
};

function getCategoryIcon(slug) {
    return CATEGORY_ICONS[slug] || '📦';
}

/**
 * Fetch categories grouped by gender (product type) from the DB.
 * Returns a Map<gender, Array<{id, name, slug}>> 
 */
async function fetchCategoriesByGender() {
    if (!isSupabaseConfigured()) return new Map();

    try {
        // Fetch active products with their category, selecting only what we need
        const { data, error } = await supabase
            .from('products')
            .select('gender, category_id, categories(id, name, slug, display_order)')
            .eq('is_active', true)
            .not('category_id', 'is', null)
            .not('gender', 'is', null);

        if (error) {
            console.error('Dynamic menu: error fetching categories', error);
            return new Map();
        }

        // Group unique categories by gender
        const genderMap = new Map();

        (data || []).forEach(p => {
            if (!p.gender || !p.categories) return;

            if (!genderMap.has(p.gender)) {
                genderMap.set(p.gender, new Map());
            }
            const catMap = genderMap.get(p.gender);
            if (!catMap.has(p.category_id)) {
                catMap.set(p.category_id, {
                    id: p.categories.id,
                    name: p.categories.name,
                    slug: p.categories.slug,
                    display_order: p.categories.display_order || 0
                });
            }
        });

        // Convert inner Maps to sorted arrays
        const result = new Map();
        genderMap.forEach((catMap, gender) => {
            const cats = Array.from(catMap.values())
                .sort((a, b) => a.display_order - b.display_order);
            result.set(gender, cats);
        });

        return result;
    } catch (err) {
        console.error('Dynamic menu: fetch error', err);
        return new Map();
    }
}

/**
 * Populate all `<ul class="menu-subcategories" data-gender="...">` elements
 * in the current page DOM with categories from the DB.
 */
async function populateMenuCategories() {
    const subcategoryLists = document.querySelectorAll('ul.menu-subcategories[data-gender]');
    if (subcategoryLists.length === 0) return;

    const categoriesByGender = await fetchCategoriesByGender();

    subcategoryLists.forEach(ul => {
        const gender = ul.dataset.gender;
        const categories = categoriesByGender.get(gender) || [];

        if (categories.length === 0) {
            // Hide empty subcategory lists
            ul.style.display = 'none';
            return;
        }

        ul.style.display = '';
        ul.innerHTML = categories.map(cat => {
            const icon = getCategoryIcon(cat.slug);
            return `<li><a href="collection.html?gender=${encodeURIComponent(gender)}&category=${encodeURIComponent(cat.slug)}">${icon} ${cat.name}</a></li>`;
        }).join('');
    });
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', populateMenuCategories);
} else {
    populateMenuCategories();
}

export { populateMenuCategories, fetchCategoriesByGender, getCategoryIcon };
