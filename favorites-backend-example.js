// ============================================
// ESEMPIO BACKEND PER SISTEMA PREFERITI
// ============================================
// Questo è un esempio di come implementare un sistema professionale
// con autenticazione utente e sincronizzazione multi-dispositivo

// --- OPZIONE 1: Con Node.js + Express + MongoDB ---

const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

// Schema MongoDB per i preferiti
const FavoriteSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    productId: { type: Number, required: true },
    gender: { type: String, enum: ['man', 'woman'], required: true },
    addedAt: { type: Date, default: Date.now }
});

// Indice composto per evitare duplicati
FavoriteSchema.index({ userId: 1, productId: 1, gender: 1 }, { unique: true });

const Favorite = mongoose.model('Favorite', FavoriteSchema);

// Middleware autenticazione
const authenticateUser = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Non autenticato' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Token non valido' });
    }
};

// API Endpoints
const app = express();
app.use(express.json());

// GET - Ottieni tutti i preferiti dell'utente
app.get('/api/favorites/:gender', authenticateUser, async (req, res) => {
    try {
        const favorites = await Favorite.find({
            userId: req.userId,
            gender: req.params.gender
        }).select('productId -_id');
        
        const productIds = favorites.map(f => f.productId);
        res.json({ favorites: productIds });
    } catch (error) {
        res.status(500).json({ error: 'Errore server' });
    }
});

// POST - Aggiungi ai preferiti
app.post('/api/favorites', authenticateUser, async (req, res) => {
    try {
        const { productId, gender } = req.body;
        
        const favorite = new Favorite({
            userId: req.userId,
            productId,
            gender
        });
        
        await favorite.save();
        res.json({ success: true, message: 'Aggiunto ai preferiti' });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ error: 'Già nei preferiti' });
        }
        res.status(500).json({ error: 'Errore server' });
    }
});

// DELETE - Rimuovi dai preferiti
app.delete('/api/favorites/:productId/:gender', authenticateUser, async (req, res) => {
    try {
        await Favorite.deleteOne({
            userId: req.userId,
            productId: parseInt(req.params.productId),
            gender: req.params.gender
        });
        
        res.json({ success: true, message: 'Rimosso dai preferiti' });
    } catch (error) {
        res.status(500).json({ error: 'Errore server' });
    }
});

// DELETE - Cancella tutti i preferiti
app.delete('/api/favorites/:gender', authenticateUser, async (req, res) => {
    try {
        await Favorite.deleteMany({
            userId: req.userId,
            gender: req.params.gender
        });
        
        res.json({ success: true, message: 'Tutti i preferiti rimossi' });
    } catch (error) {
        res.status(500).json({ error: 'Errore server' });
    }
});


// ============================================
// FRONTEND - Integrazione con il backend
// ============================================

class FavoritesManager {
    constructor(gender) {
        this.gender = gender;
        this.apiUrl = '/api/favorites';
        this.token = localStorage.getItem('authToken'); // Token JWT dell'utente
    }

    // Headers con autenticazione
    getHeaders() {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
        };
    }

    // Carica preferiti dal server
    async loadFavorites() {
        try {
            const response = await fetch(`${this.apiUrl}/${this.gender}`, {
                headers: this.getHeaders()
            });
            
            if (!response.ok) throw new Error('Errore caricamento');
            
            const data = await response.json();
            return data.favorites;
        } catch (error) {
            console.error('Errore caricamento preferiti:', error);
            // Fallback a localStorage se il server non è disponibile
            return this.loadFromLocalStorage();
        }
    }

    // Aggiungi ai preferiti
    async addFavorite(productId) {
        try {
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({ productId, gender: this.gender })
            });
            
            if (!response.ok) throw new Error('Errore aggiunta');
            
            // Aggiorna anche localStorage come cache
            this.addToLocalStorage(productId);
            return true;
        } catch (error) {
            console.error('Errore aggiunta preferito:', error);
            // Fallback a localStorage
            this.addToLocalStorage(productId);
            return false;
        }
    }

    // Rimuovi dai preferiti
    async removeFavorite(productId) {
        try {
            const response = await fetch(`${this.apiUrl}/${productId}/${this.gender}`, {
                method: 'DELETE',
                headers: this.getHeaders()
            });
            
            if (!response.ok) throw new Error('Errore rimozione');
            
            this.removeFromLocalStorage(productId);
            return true;
        } catch (error) {
            console.error('Errore rimozione preferito:', error);
            this.removeFromLocalStorage(productId);
            return false;
        }
    }

    // Cancella tutti i preferiti
    async clearAllFavorites() {
        try {
            const response = await fetch(`${this.apiUrl}/${this.gender}`, {
                method: 'DELETE',
                headers: this.getHeaders()
            });
            
            if (!response.ok) throw new Error('Errore cancellazione');
            
            this.clearLocalStorage();
            return true;
        } catch (error) {
            console.error('Errore cancellazione preferiti:', error);
            this.clearLocalStorage();
            return false;
        }
    }

    // Metodi localStorage come fallback/cache
    loadFromLocalStorage() {
        const key = `avenue_favorites_${this.gender}`;
        const stored = localStorage.getItem(key);
        return stored ? JSON.parse(stored) : [];
    }

    addToLocalStorage(productId) {
        const favorites = this.loadFromLocalStorage();
        if (!favorites.includes(productId)) {
            favorites.push(productId);
            localStorage.setItem(`avenue_favorites_${this.gender}`, JSON.stringify(favorites));
        }
    }

    removeFromLocalStorage(productId) {
        let favorites = this.loadFromLocalStorage();
        favorites = favorites.filter(id => id !== productId);
        localStorage.setItem(`avenue_favorites_${this.gender}`, JSON.stringify(favorites));
    }

    clearLocalStorage() {
        localStorage.setItem(`avenue_favorites_${this.gender}`, JSON.stringify([]));
    }

    // Sincronizza localStorage con server (utile dopo login)
    async syncWithServer() {
        const localFavorites = this.loadFromLocalStorage();
        const serverFavorites = await this.loadFavorites();
        
        // Unisci i preferiti locali con quelli del server
        const allFavorites = [...new Set([...localFavorites, ...serverFavorites])];
        
        // Carica i preferiti locali sul server
        for (const productId of localFavorites) {
            if (!serverFavorites.includes(productId)) {
                await this.addFavorite(productId);
            }
        }
        
        // Aggiorna localStorage con tutti i preferiti
        localStorage.setItem(`avenue_favorites_${this.gender}`, JSON.stringify(allFavorites));
        
        return allFavorites;
    }
}

// ============================================
// UTILIZZO NEL FRONTEND
// ============================================

// Inizializza il manager
const favoritesManager = new FavoritesManager(gender);

// Carica i preferiti all'avvio (con sincronizzazione se utente loggato)
async function initializeFavorites() {
    const token = localStorage.getItem('authToken');
    
    if (token) {
        // Utente autenticato: sincronizza con server
        const favorites = await favoritesManager.syncWithServer();
        updateUI(favorites);
    } else {
        // Utente guest: usa solo localStorage
        const favorites = favoritesManager.loadFromLocalStorage();
        updateUI(favorites);
    }
}

// Toggle preferito
async function toggleFavorite(productId) {
    const favorites = favoritesManager.loadFromLocalStorage();
    const isFavorite = favorites.includes(productId);
    
    if (isFavorite) {
        await favoritesManager.removeFavorite(productId);
    } else {
        await favoritesManager.addFavorite(productId);
    }
    
    return !isFavorite;
}


// ============================================
// OPZIONE 2: Con Firebase (più semplice)
// ============================================

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, deleteDoc, getDocs, query, where } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
    // La tua configurazione Firebase
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

class FirebaseFavoritesManager {
    constructor(gender) {
        this.gender = gender;
    }

    async loadFavorites() {
        const user = auth.currentUser;
        if (!user) return this.loadFromLocalStorage();

        const q = query(
            collection(db, 'favorites'),
            where('userId', '==', user.uid),
            where('gender', '==', this.gender)
        );

        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => doc.data().productId);
    }

    async addFavorite(productId) {
        const user = auth.currentUser;
        if (!user) {
            this.addToLocalStorage(productId);
            return;
        }

        const docRef = doc(db, 'favorites', `${user.uid}_${productId}_${this.gender}`);
        await setDoc(docRef, {
            userId: user.uid,
            productId,
            gender: this.gender,
            addedAt: new Date()
        });
    }

    async removeFavorite(productId) {
        const user = auth.currentUser;
        if (!user) {
            this.removeFromLocalStorage(productId);
            return;
        }

        const docRef = doc(db, 'favorites', `${user.uid}_${productId}_${this.gender}`);
        await deleteDoc(docRef);
    }

    // Metodi localStorage come prima...
}


// ============================================
// RIEPILOGO CONFRONTO
// ============================================

/*
┌─────────────────────┬──────────────────┬─────────────────────┐
│ Caratteristica      │ localStorage     │ Backend + Database  │
├─────────────────────┼──────────────────┼─────────────────────┤
│ Sincronizzazione    │ ❌ No            │ ✅ Sì               │
│ Multi-dispositivo   │ ❌ No            │ ✅ Sì               │
│ Persistenza         │ ✅ Sì (locale)   │ ✅ Sì (server)      │
│ Traffico elevato    │ ✅ Ottimo        │ ✅ Ottimo           │
│ Autenticazione      │ ❌ No            │ ✅ Sì               │
│ Complessità         │ ✅ Bassa         │ ⚠️ Media/Alta       │
│ Costo               │ ✅ Gratis        │ ⚠️ Hosting/DB       │
│ Privacy             │ ✅ Massima       │ ⚠️ Serve GDPR       │
│ Offline             │ ✅ Funziona      │ ❌ Serve connessione│
└─────────────────────┴──────────────────┴─────────────────────┘

RACCOMANDAZIONE:
- Per un sito vetrina/demo: localStorage è perfetto ✅
- Per un e-commerce vero: Backend + Database è necessario ✅
- Soluzione ibrida: Usa entrambi (localStorage come cache + backend per sync)
*/
