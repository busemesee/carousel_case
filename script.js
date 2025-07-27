(() => {
    'use strict';

    const CONFIG = Object.freeze({
        CACHE: {
            DURATION: 24 * 60 * 60 * 1000,
            KEYS: {
                PRODUCTS: 'lcw_urun_listesi',
                FAVORITES: 'lcw_favoriler', 
                TIMESTAMP: 'lcw_urun_zamani'
            }
        },
        
        API: {
            URL: 'https://gist.githubusercontent.com/sevindi/5765c5812bbc8238a38b3cf52f233651/raw/56261d81af8561bf0a7cf692fe572f9e1e91f372/products.json',
            TIMEOUT: 10000,
            RETRY_ATTEMPTS: 3,
            RETRY_DELAY: 1000
        },
        
        UI: {
            DEBOUNCE_DELAY: 200,
            RESPONSIVE: {
                MOBILE: 480,
                TABLET: 768, 
                DESKTOP: 1024
            },
            VISIBLE_COUNT: {
                MOBILE: 2,
                TABLET: 2,
                MEDIUM: 3,
                DESKTOP: 4
            }
        }
    });

    class CarouselState {
        #products = [];
        #favorites = new Set();
        #currentIndex = 0;
        #visibleCount = 4;
        #isLoading = false;
        #eventListeners = [];

        get products() { return [...this.#products]; }
        get favorites() { return [...this.#favorites]; }
        get currentIndex() { return this.#currentIndex; }
        get visibleCount() { return this.#visibleCount; }
        get isLoading() { return this.#isLoading; }
        get maxIndex() { return Math.max(0, this.#products.length - this.#visibleCount); }

        setProducts(products) {
            if (!Array.isArray(products)) throw new TypeError('Products must be array');
            this.#products = products;
        }

        setFavorites(favorites) {
            this.#favorites = new Set(Array.isArray(favorites) ? favorites : []);
        }

        setCurrentIndex(index) {
            this.#currentIndex = Math.max(0, Math.min(index, this.maxIndex));
        }

        setVisibleCount(count) {
            this.#visibleCount = Math.max(1, count);
        }

        setLoading(loading) {
            this.#isLoading = Boolean(loading);
        }

        addFavorite(id) { this.#favorites.add(String(id)); }
        removeFavorite(id) { this.#favorites.delete(String(id)); }
        isFavorite(id) { return this.#favorites.has(String(id)); }
        canGoNext() { return this.#currentIndex < this.maxIndex; }
        canGoPrevious() { return this.#currentIndex > 0; }

        addEventListener(element, event, handler, options = {}) {
            element.addEventListener(event, handler, options);
            this.#eventListeners.push({ element, event, handler, options });
        }

        cleanup() {
            this.#eventListeners.forEach(({ element, event, handler, options }) => {
                element.removeEventListener(event, handler, options);
            });
            this.#eventListeners = [];
        }
    }

    class Utils {
        static debounce(func, wait) {
            let timeout;
            return (...args) => {
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(this, args), wait);
            };
        }

        static async sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        static sanitize(str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }

        static isValidURL(str) {
            try {
                new URL(str);
                return true;
            } catch {
                return false;
            }
        }
    }

    class Storage {
        static get(key, fallback = null) {
            try {
                const item = localStorage.getItem(key);
                return item ? JSON.parse(item) : fallback;
            } catch {
                return fallback;
            }
        }

        static set(key, value) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
                return true;
            } catch {
                return false;
            }
        }

        static isCacheValid() {
            const timestamp = this.get(CONFIG.CACHE.KEYS.TIMESTAMP);
            if (!timestamp) return false;
            return (Date.now() - timestamp) < CONFIG.CACHE.DURATION;
        }
    }

    class ApiClient {
        static async fetchWithRetry(url, retryCount = 0) {
            try {
                const controller = new AbortController();
                setTimeout(() => controller.abort(), CONFIG.API.TIMEOUT);
                
                const response = await fetch(url, { signal: controller.signal });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                
                return response;
            } catch (error) {
                if (retryCount < CONFIG.API.RETRY_ATTEMPTS) {
                    await Utils.sleep(CONFIG.API.RETRY_DELAY * (retryCount + 1));
                    return this.fetchWithRetry(url, retryCount + 1);
                }
                throw error;
            }
        }

        static async getProducts() {
            const response = await this.fetchWithRetry(CONFIG.API.URL);
            const data = await response.json();
            return data.products || data;
        }
    }

    class ProductCarousel {
        #state = new CarouselState();

        constructor() {
            this.#initialize();
        }

        async #initialize() {
            try {
                if (!this.#isProductPage()) {
                    console.log('bu kod sadece urun sayfalarinda calisir');
                    return;
                }

                await this.#loadData();
                this.#render();
                this.#setupEvents();
                this.#handleResponsive();
                
                console.log('Carousel initialized');
            } catch (error) {
                console.error('Initialization failed:', error);
            }
        }

        #isProductPage() {
            return window.location.href.includes('/p-') || 
                   document.querySelector('.product-detail');
        }

        async #loadData() {
            this.#state.setLoading(true);

            try {
                const favorites = Storage.get(CONFIG.CACHE.KEYS.FAVORITES, []);
                this.#state.setFavorites(favorites);

                let products;
                if (Storage.isCacheValid()) {
                    products = Storage.get(CONFIG.CACHE.KEYS.PRODUCTS);
                    console.log('urunler onceden yuklendi');
                }

                if (!products) {
                    products = await ApiClient.getProducts();
                    Storage.set(CONFIG.CACHE.KEYS.PRODUCTS, products);
                    Storage.set(CONFIG.CACHE.KEYS.TIMESTAMP, Date.now());
                }

                this.#state.setProducts(products);
            } finally {
                this.#state.setLoading(false);
            }
        }

        #render() {
            const existing = document.querySelector('.benzer-urunler-container');

            if (existing) existing.remove();

            const container = document.createElement('div');
            container.className = 'benzer-urunler-container';
            
            let icerik = '<div class="benzer-urunler-baslik"><h2> Bunları da Beğenebilirsiniz</h2></div>';
            icerik += '<div class="carousel-wrapper">';
            icerik += '<button class="carousel-btn sol-btn"><</button>';
            icerik += '<div class="urunler-listesi"><div class="urunler-ic">';

            for (let i = 0; i < this.#state.products.length; i++) {
                const urun = this.#state.products[i];
                const favorideMi = this.#state.isFavorite(urun.id);
                
                icerik += `
                    <div class="urun-kart" data-index="${i}">
                        <div class="urun-gorsel">
                            <img src="${urun.img}" alt="${Utils.sanitize(urun.name)}">
                            <button class="favori-btn ${favorideMi ? 'aktif' : ''}" data-id="${urun.id}">
                                <svg width="20" height="20" viewBox="0 0 24 24">
                                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                                </svg>
                            </button>
                        </div>
                        <div class="urun-bilgi">
                            <div class="urun-ad">${Utils.sanitize(urun.name)}</div>
                            <div class="urun-fiyat">${urun.price} TL</div>
                        </div>
                    </div>
                `;
            }
            
            icerik += '</div></div>';
            icerik += '<button class="carousel-btn sag-btn">></button>';
            icerik += '</div>';
            
            container.innerHTML = icerik;

            const hedef = document.querySelector('.product-detail');
            if (hedef) {
                hedef.parentNode.insertBefore(container, hedef.nextSibling);
            }

            this.#addStyles();
        }

        #addStyles() {
            const existing = document.querySelector('.lcw-carousel-styles');
            if (existing) existing.remove();

            const stil = document.createElement('style');
            stil.className = 'lcw-carousel-styles';

            stil.textContent = `
                .benzer-urunler-container {
                    margin: 30px 0;
                    padding: 0 15px;
                    background-color: #f4f5f7;
                }
                
                .benzer-urunler-baslik h2 {
                    font-size: 22px;
                    margin-bottom: 20px;
                    font-weight: normal;
                    color: #333;
                }
                
                .carousel-wrapper {
                    position: relative;
                    padding: 66px;
                }
                
                .urunler-listesi {
                    overflow: hidden;
                    margin: 0px 24px;
                }
                
                .urunler-ic {
                    display: flex;
                    gap: 15px;
                    transition: transform 0.3s;
                }
                
                .urun-kart {
                    flex: 0 0 calc(25% - 40.25px);
                    cursor: pointer;
                }
                
                .urun-kart:hover {
                    transform: translateY(-2px);
                }
                
                .urun-gorsel {
                    position: relative;
                    background: #f5f5f5;
                    padding-bottom: 133%;
                    overflow: hidden;
                }
                
                .urun-gorsel img {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }
                
                .favori-btn {
                    position: absolute;
                    top: 10px;
                    right: 10px;
                    width: 35px;
                    height: 35px;
                    border-radius: 50%;
                    background: white;
                    border: 1px solid #ddd;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                
                .favori-btn:hover {
                    transform: scale(1.1);
                }
                
                .favori-btn svg {
                    width: 18px;
                    height: 18px;
                    fill: none;
                    stroke: #666;
                    stroke-width: 2;
                }
                
                .favori-btn.aktif svg {
                    fill: #0066cc;
                    stroke: #0066cc;
                }
                
                .urun-bilgi {
                    padding: 10px 0;
                    background-color: #fff;
                }
                
                .urun-ad {
                    font-size: 14px;
                    color: #333;
                    margin-bottom: 5px;
                    height: 40px;
                    overflow: hidden;
                    padding-left: 8px;
                    padding-right: 8px;
                }
                
                .urun-fiyat {
                    font-size: 16px;
                    font-weight: bold;
                    color: #183db0;
                    margin-top: 30px;
                    margin-left: 8px;
                }
                
                .carousel-btn {
                    position: absolute;
                    top: 50%;
                    transform: translateY(-50%);
                    width: 36px;
                    height: 36px;
                    border-radius: 50%;
                    background: white;
                    border: 1px solid #ddd;
                    cursor: pointer;
                    font-size: 18px;
                    color: #666;
                    z-index: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .carousel-btn:hover {
                    background: #f0f0f0;
                }
                
                .carousel-btn:disabled {
                    opacity: 0.3;
                    cursor: default;
                }
                
                .sol-btn {
                    left: 0;
                }
                
                .sag-btn {
                    right: 0;
                }
                
                @media (max-width: 1024px) {
                    .urun-kart {
                        flex: 0 0 calc(33.333% - 10px);
                    }
                }
                
                @media (max-width: 768px) {
                    .benzer-urunler-baslik h2 {
                        font-size: 18px;
                    }
                    
                    .urun-kart {
                        flex: 0 0 calc(50% - 7.5px);
                    }
                    
                    .urunler-listesi {
                        margin: 0 30px;
                    }
                    
                    .carousel-btn {
                        width: 30px;
                        height: 30px;
                        font-size: 16px;
                    }
                }
                
                @media (max-width: 480px) {
                    .carousel-btn {
                        display: none;
                    }
                    
                    .urunler-listesi {
                        margin: 0;
                        overflow-x: auto;
                        -webkit-overflow-scrolling: touch;
                    }
                    
                    .urunler-listesi::-webkit-scrollbar {
                        display: none;
                    }
                    
                    .urun-kart {
                        flex: 0 0 calc(50% - 5px);
                    }
                    
                    .urunler-ic {
                        gap: 10px;
                    }
                }
            `;
            
            document.head.appendChild(stil);
        }

        #setupEvents() {
            const kartlar = document.querySelectorAll('.urun-kart');
            kartlar.forEach(kart => {
                this.#state.addEventListener(kart, 'click', (e) => {
                    if (!e.target.closest('.favori-btn')) {
                        const idx = kart.getAttribute('data-index');
                        const urun = this.#state.products[idx];
                        if (urun?.url && Utils.isValidURL(urun.url)) {
                            window.open(urun.url, '_blank', 'noopener,noreferrer');
                        }
                    }
                });
            });
            
            const favButonlari = document.querySelectorAll('.favori-btn');
            favButonlari.forEach(btn => {
                this.#state.addEventListener(btn, 'click', (e) => {
                    e.stopPropagation();
                    
                    const urunId = btn.getAttribute('data-id');
                    
                    if (this.#state.isFavorite(urunId)) {
                        this.#state.removeFavorite(urunId);
                        btn.classList.remove('aktif');
                    } else {
                        this.#state.addFavorite(urunId);
                        btn.classList.add('aktif');
                    }
                    
                    Storage.set(CONFIG.CACHE.KEYS.FAVORITES, this.#state.favorites);
                });
            });

            const solBtn = document.querySelector('.sol-btn');
            const sagBtn = document.querySelector('.sag-btn');
            
            if (solBtn) {
                this.#state.addEventListener(solBtn, 'click', () => {
                    if (this.#state.canGoPrevious()) {
                        this.#state.setCurrentIndex(this.#state.currentIndex - 1);
                        this.#updateCarousel();
                    }
                });
            }
            
            if (sagBtn) {
                this.#state.addEventListener(sagBtn, 'click', () => {
                    if (this.#state.canGoNext()) {
                        this.#state.setCurrentIndex(this.#state.currentIndex + 1);
                        this.#updateCarousel();
                    }
                });
            }
            
            this.#updateButtons();
        }

        #updateCarousel() {
            const icDiv = document.querySelector('.urunler-ic');
            if (!icDiv) return;

            const kartGenislik = document.querySelector('.urun-kart')?.offsetWidth || 0;
            const bosluk = 15;
            const kaydir = this.#state.currentIndex * (kartGenislik + bosluk);
            
            icDiv.style.transform = `translateX(-${kaydir}px)`;
            this.#updateButtons();
        }

        #updateButtons() {
            const solBtn = document.querySelector('.sol-btn');
            const sagBtn = document.querySelector('.sag-btn');
            
            if (solBtn) solBtn.disabled = !this.#state.canGoPrevious();
            if (sagBtn) sagBtn.disabled = !this.#state.canGoNext();
        }

        #handleResponsive() {
            const genislik = window.innerWidth;
            
            if (genislik <= 480) {
                this.#state.setVisibleCount(2);
            } else if (genislik <= 768) {
                this.#state.setVisibleCount(2);
            } else if (genislik <= 1024) {
                this.#state.setVisibleCount(3);
            } else {
                this.#state.setVisibleCount(4);
            }

            if (this.#state.currentIndex > this.#state.maxIndex) {
                this.#state.setCurrentIndex(this.#state.maxIndex);
            }
            
            this.#updateCarousel();

            const debouncedResize = Utils.debounce(() => this.#handleResponsive(), CONFIG.UI.DEBOUNCE_DELAY);
            this.#state.addEventListener(window, 'resize', debouncedResize);
        }

        destroy() {
            this.#state.cleanup();
            const container = document.querySelector('.benzer-urunler-container');
            const styles = document.querySelector('.lcw-carousel-styles');
            if (container) container.remove();
            if (styles) styles.remove();
        }
    }

    let carouselInstance = null;

    const initialize = () => {
        try {
            if (carouselInstance) {
                carouselInstance.destroy();
            }
            carouselInstance = new ProductCarousel();

            window.lcwCarousel = {
                destroy: () => carouselInstance?.destroy()
            };
            
        } catch (error) {
            console.error('Carousel initialization failed:', error);
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    if (window.location.hostname === 'localhost' || window.location.search.includes('debug=true')) {
        window.LCW_DEBUG = { carouselInstance, initialize };
    }

})();