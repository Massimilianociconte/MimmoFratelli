/**
 * Stock Alerts Service
 * Manages "Notify me when available" subscriptions
 */

import { supabase, isSupabaseConfigured, getCurrentUser } from '../supabase.js';

class StockAlertService {
    /**
     * Subscribe to stock alert for a product
     */
    async subscribe(productId) {
        if (!isSupabaseConfigured()) return { success: false, error: 'Supabase not configured' };
        
        const user = await getCurrentUser();
        if (!user) return { success: false, error: 'Login required' };
        
        try {
            const { error } = await supabase
                .from('stock_alerts')
                .upsert({
                    user_id: user.id,
                    product_id: productId,
                    is_active: true,
                    notified_at: null
                }, {
                    onConflict: 'user_id,product_id'
                });
            
            if (error) throw error;
            return { success: true };
        } catch (err) {
            console.error('Error subscribing to stock alert:', err);
            return { success: false, error: err.message };
        }
    }
    
    /**
     * Unsubscribe from stock alert
     */
    async unsubscribe(productId) {
        if (!isSupabaseConfigured()) return { success: false };
        
        const user = await getCurrentUser();
        if (!user) return { success: false };
        
        try {
            const { error } = await supabase
                .from('stock_alerts')
                .delete()
                .eq('user_id', user.id)
                .eq('product_id', productId);
            
            if (error) throw error;
            return { success: true };
        } catch (err) {
            console.error('Error unsubscribing from stock alert:', err);
            return { success: false };
        }
    }
    
    /**
     * Check if user has active alert for product
     */
    async hasAlert(productId) {
        if (!isSupabaseConfigured()) return false;
        
        const user = await getCurrentUser();
        if (!user) return false;
        
        try {
            const { data, error } = await supabase
                .from('stock_alerts')
                .select('id')
                .eq('user_id', user.id)
                .eq('product_id', productId)
                .eq('is_active', true)
                .maybeSingle();
            
            return !error && !!data;
        } catch {
            return false;
        }
    }
    
    /**
     * Get all active alerts for current user
     */
    async getMyAlerts() {
        if (!isSupabaseConfigured()) return [];
        
        const user = await getCurrentUser();
        if (!user) return [];
        
        try {
            const { data, error } = await supabase
                .from('stock_alerts')
                .select(`
                    id,
                    product_id,
                    created_at,
                    products (
                        id,
                        name,
                        slug,
                        images,
                        is_active
                    )
                `)
                .eq('user_id', user.id)
                .eq('is_active', true)
                .order('created_at', { ascending: false });
            
            return error ? [] : data;
        } catch {
            return [];
        }
    }
}

export const stockAlertService = new StockAlertService();
export default stockAlertService;
