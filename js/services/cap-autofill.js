/**
 * CAP Autofill Service
 * Mimmo Fratelli - E-commerce
 * 
 * Provides autocomplete functionality for Italian cities and postal codes
 */

class CapAutofillService {
    constructor() {
        this.data = null;
        this.cityToCapMap = new Map();
        this.capToCityMap = new Map();
        this.loaded = false;
    }

    /**
     * Load the CAP database
     */
    async load() {
        if (this.loaded) return;
        
        try {
            const response = await fetch('/autofill-cap/gi_comuni_cap.json');
            if (!response.ok) throw new Error('Failed to load CAP data');
            
            this.data = await response.json();
            this._buildMaps();
            this.loaded = true;
        } catch (err) {
            console.error('Error loading CAP data:', err);
        }
    }

    /**
     * Build lookup maps for fast searching
     * @private
     */
    _buildMaps() {
        if (!this.data) return;
        
        for (const item of this.data) {
            const cityName = item.denominazione_ita.toLowerCase();
            const cap = item.cap;
            const province = item.sigla_provincia;
            
            // City -> CAP mapping (some cities have multiple CAPs)
            if (!this.cityToCapMap.has(cityName)) {
                this.cityToCapMap.set(cityName, []);
            }
            this.cityToCapMap.get(cityName).push({
                cap,
                province,
                fullName: item.denominazione_ita
            });
            
            // CAP -> City mapping
            if (!this.capToCityMap.has(cap)) {
                this.capToCityMap.set(cap, []);
            }
            this.capToCityMap.get(cap).push({
                city: item.denominazione_ita,
                province
            });
        }
    }

    /**
     * Search cities by name (for autocomplete)
     * @param {string} query - Partial city name
     * @param {number} limit - Max results
     * @returns {Array} Matching cities
     */
    searchCities(query, limit = 10) {
        if (!this.loaded || !query || query.length < 2) return [];
        
        const normalizedQuery = query.toLowerCase().trim();
        const results = [];
        const seen = new Set();
        
        for (const item of this.data) {
            const cityName = item.denominazione_ita.toLowerCase();
            
            if (cityName.startsWith(normalizedQuery) && !seen.has(cityName)) {
                seen.add(cityName);
                results.push({
                    city: item.denominazione_ita,
                    cap: item.cap,
                    province: item.sigla_provincia
                });
                
                if (results.length >= limit) break;
            }
        }
        
        // If not enough results, search for contains
        if (results.length < limit) {
            for (const item of this.data) {
                const cityName = item.denominazione_ita.toLowerCase();
                
                if (cityName.includes(normalizedQuery) && !seen.has(cityName)) {
                    seen.add(cityName);
                    results.push({
                        city: item.denominazione_ita,
                        cap: item.cap,
                        province: item.sigla_provincia
                    });
                    
                    if (results.length >= limit) break;
                }
            }
        }
        
        return results;
    }

    /**
     * Get CAP by city name
     * @param {string} cityName - City name
     * @returns {Object|null} CAP and province info
     */
    getCapByCity(cityName) {
        if (!this.loaded || !cityName) return null;
        
        const normalized = cityName.toLowerCase().trim();
        const data = this.cityToCapMap.get(normalized);
        
        if (data && data.length > 0) {
            return data[0]; // Return first match
        }
        
        return null;
    }

    /**
     * Get city by CAP
     * @param {string} cap - Postal code
     * @returns {Object|null} City and province info
     */
    getCityByCap(cap) {
        if (!this.loaded || !cap) return null;
        
        const normalized = cap.trim();
        const data = this.capToCityMap.get(normalized);
        
        if (data && data.length > 0) {
            return data[0]; // Return first match
        }
        
        return null;
    }
}

export const capAutofillService = new CapAutofillService();
export default capAutofillService;
