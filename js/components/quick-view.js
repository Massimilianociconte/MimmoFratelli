/**
 * Quick View Modal Component
 * Avenue M. E-commerce Platform
 * 
 * Enhanced quick-view with size/color selection and add to cart
 */

import { cartService } from '../services/cart.js';

class QuickViewModal {
  constructor() {
    this.modal = null;
    this.currentProduct = null;
    this.selectedSize = null;
    this.selectedColor = null;
    this.quantity = 1;
    this.init();
  }

  init() {
    this.createModal();
    this.bindEvents();
  }

  createModal() {
    const modal = document.createElement('div');
    modal.className = 'quick-view-modal';
    modal.innerHTML = `
      <div class="quick-view-overlay"></div>
      <div class="quick-view-content">
        <button class="quick-view-close" aria-label="Chiudi">&times;</button>
        <div class="quick-view-grid">
          <div class="quick-view-gallery">
            <img class="quick-view-image" src="" alt="">
            <div class="quick-view-thumbnails"></div>
          </div>
          <div class="quick-view-details">
            <h2 class="quick-view-title"></h2>
            <p class="quick-view-price"></p>
            <p class="quick-view-description"></p>
            
            <div class="quick-view-options">
              <div class="quick-view-sizes">
                <label>Taglia</label>
                <div class="size-buttons"></div>
              </div>
              <div class="quick-view-colors">
                <label>Colore</label>
                <div class="color-buttons"></div>
              </div>
              <div class="quick-view-quantity">
                <label>Quantità</label>
                <div class="quantity-selector">
                  <button class="qty-btn qty-minus">-</button>
                  <input type="number" class="qty-input" value="1" min="1" max="10">
                  <button class="qty-btn qty-plus">+</button>
                </div>
              </div>
            </div>
            
            <button class="quick-view-add-cart btn btn-primary">Aggiungi al Carrello</button>
            <a class="quick-view-link" href="">Vedi Dettagli Completi →</a>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    this.modal = modal;
  }

  bindEvents() {
    this.modal.querySelector('.quick-view-overlay').addEventListener('click', () => this.close());
    this.modal.querySelector('.quick-view-close').addEventListener('click', () => this.close());
    
    this.modal.querySelector('.qty-minus').addEventListener('click', () => this.updateQuantity(-1));
    this.modal.querySelector('.qty-plus').addEventListener('click', () => this.updateQuantity(1));
    this.modal.querySelector('.qty-input').addEventListener('change', (e) => {
      this.quantity = Math.max(1, Math.min(10, parseInt(e.target.value) || 1));
      e.target.value = this.quantity;
    });
    
    this.modal.querySelector('.quick-view-add-cart').addEventListener('click', () => this.addToCart());
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modal.classList.contains('active')) {
        this.close();
      }
    });
  }

  open(product) {
    this.currentProduct = product;
    this.selectedSize = null;
    this.selectedColor = null;
    this.quantity = 1;
    
    this.render();
    this.modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  close() {
    this.modal.classList.remove('active');
    document.body.style.overflow = '';
  }

  render() {
    const p = this.currentProduct;
    
    this.modal.querySelector('.quick-view-image').src = p.images?.[0] || 'Images/placeholder.jpg';
    this.modal.querySelector('.quick-view-image').alt = p.name;
    this.modal.querySelector('.quick-view-title').textContent = p.name;
    this.modal.querySelector('.quick-view-price').textContent = `€${p.price?.toFixed(2)}`;
    this.modal.querySelector('.quick-view-description').textContent = p.description || '';
    this.modal.querySelector('.quick-view-link').href = `product.html?id=${p.id}`;
    this.modal.querySelector('.qty-input').value = 1;
    
    // Render thumbnails
    const thumbsContainer = this.modal.querySelector('.quick-view-thumbnails');
    thumbsContainer.innerHTML = (p.images || []).map((img, i) => `
      <img src="${img}" alt="" class="thumb ${i === 0 ? 'active' : ''}" data-index="${i}">
    `).join('');
    
    thumbsContainer.querySelectorAll('.thumb').forEach(thumb => {
      thumb.addEventListener('click', () => {
        this.modal.querySelector('.quick-view-image').src = p.images[thumb.dataset.index];
        thumbsContainer.querySelectorAll('.thumb').forEach(t => t.classList.remove('active'));
        thumb.classList.add('active');
      });
    });
    
    // Render sizes
    const sizes = p.sizes || ['XS', 'S', 'M', 'L', 'XL'];
    const sizesContainer = this.modal.querySelector('.size-buttons');
    sizesContainer.innerHTML = sizes.map(size => `
      <button class="size-btn" data-size="${size}">${size}</button>
    `).join('');
    
    sizesContainer.querySelectorAll('.size-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        sizesContainer.querySelectorAll('.size-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.selectedSize = btn.dataset.size;
      });
    });
    
    // Render colors
    const colors = p.colors || ['Nero', 'Bianco', 'Blu'];
    const colorsContainer = this.modal.querySelector('.color-buttons');
    colorsContainer.innerHTML = colors.map(color => `
      <button class="color-btn" data-color="${color}" title="${color}">
        <span class="color-swatch" style="background: ${this.getColorHex(color)}"></span>
        ${color}
      </button>
    `).join('');
    
    colorsContainer.querySelectorAll('.color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        colorsContainer.querySelectorAll('.color-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.selectedColor = btn.dataset.color;
      });
    });
  }

  getColorHex(colorName) {
    const colors = {
      'Nero': '#1a1a1a',
      'Bianco': '#ffffff',
      'Blu': '#1e3a5f',
      'Rosso': '#a83f39',
      'Verde': '#2d5a27',
      'Grigio': '#6b6b6b',
      'Beige': '#d4c4a8',
      'Marrone': '#5c4033'
    };
    return colors[colorName] || '#cccccc';
  }

  updateQuantity(delta) {
    this.quantity = Math.max(1, Math.min(10, this.quantity + delta));
    this.modal.querySelector('.qty-input').value = this.quantity;
  }

  async addToCart() {
    if (!this.selectedSize) {
      alert('Seleziona una taglia');
      return;
    }
    if (!this.selectedColor) {
      alert('Seleziona un colore');
      return;
    }

    const item = {
      productId: this.currentProduct.id,
      name: this.currentProduct.name,
      price: this.currentProduct.price,
      image: this.currentProduct.images?.[0] || '',
      size: this.selectedSize,
      color: this.selectedColor,
      quantity: this.quantity
    };

    const result = await cartService.addItem(item);
    
    if (result.success) {
      this.close();
      // Trigger cart update event
      document.dispatchEvent(new CustomEvent('cartUpdated'));
      // Show confirmation
      this.showConfirmation();
    } else {
      alert(result.error || 'Errore nell\'aggiunta al carrello');
    }
  }

  showConfirmation() {
    const toast = document.createElement('div');
    toast.className = 'cart-toast';
    toast.innerHTML = `
      <span>✓</span> Aggiunto al carrello
    `;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }
}

export const quickViewModal = new QuickViewModal();
export default quickViewModal;
