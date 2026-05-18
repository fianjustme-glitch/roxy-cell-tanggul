import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, 
  Smartphone, 
  Bike, 
  MapPin, 
  Clock, 
  MessageCircle, 
  Download, 
  Plus, 
  Trash2, 
  ShoppingCart, 
  Calculator,
  Lock,
  ChevronRight,
  TrendingDown,
  ShieldCheck,
  Zap,
  Battery,
  Box,
  CreditCard,
  X,
  Edit3,
  LogIn,
  LogOut
} from 'lucide-react';

// Firebase Imports
import { db, auth } from './lib/firebase';
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged,
  signOut,
  User
} from 'firebase/auth';

// --- DATA STRUCTURES ---

interface Product {
  id: string;
  name: string;
  price: number; 
  originalPrice?: number;
  category: 'hp' | 'ebike';
  type: 'baru' | 'bekas' | 'ebike';
  badge?: string;
  image: string;
  specs: string[];
  stock: number;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  alert(`Error: ${errInfo.error}. Role admin mungkin diperlukan.`);
  throw new Error(JSON.stringify(errInfo));
};

// --- UTILS ---
const formatIDR = (num: number) => {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(num);
};

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [activeTab, setActiveTab] = useState<'hp' | 'ebike'>('hp');
  const [searchQuery, setSearchQuery] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [isAdminMode, setIsAdminMode] = useState(false);
  
  // Cart & POS State
  const [cart, setCart] = useState<{product: Product, qty: number}[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [cashPaid, setCashPaid] = useState<number>(0);

  // Form State
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  // Auth Listener
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
  }, []);

  // Sync Products from Firestore
  useEffect(() => {
    const q = query(collection(db, 'products'));
    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        const prods = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Product));
        setProducts(prods);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'products')
    );
    return () => unsubscribe();
  }, []);

  // AI Actions
  const generateAIImage = async () => {
    const nameInput = document.querySelector('input[name="name"]') as HTMLInputElement;
    const catInput = document.querySelector('select[name="category"]') as HTMLSelectElement;
    const imgInput = document.querySelector('input[name="image"]') as HTMLInputElement;

    if (!nameInput?.value) return alert('Ketik nama produk dulu!');
    
    setIsGeneratingImage(true);
    try {
      const resp = await fetch('/api/gemini/generate-image-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productName: nameInput.value, category: catInput.value })
      });
      const data = await resp.json();
      if (data.suggestedUrl) {
        imgInput.value = data.suggestedUrl;
        // Trigger React to update the form state if needed, but here we use uncontrolled for simplicity or we can update a state.
        // Let's actually use a controlled state for the form to make it cleaner.
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const updateStock = async (id: string, delta: number) => {
    const product = products.find(p => p.id === id);
    if (!product) return;
    try {
      const prodRef = doc(db, 'products', id);
      await updateDoc(prodRef, {
        stock: Math.max(0, (product.stock || 0) + delta)
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'products/' + id);
    }
  };

  // Auth Actions
  const login = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (e) {
      console.error(e);
    }
  };

  const logout = () => signOut(auth);

  const filteredProducts = useMemo(() => {
    return products.filter(p => 
      p.category === activeTab && 
      p.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [products, activeTab, searchQuery]);

  // POS Actions
  const addToCart = (product: Product) => {
    if (product.stock <= 0) return alert('Stok Habis!');
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        return prev.map(item => item.product.id === product.id ? { ...item, qty: item.qty + 1 } : item);
      }
      return [...prev, { product, qty: 1 }];
    });
    setIsCartOpen(true);
  };

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(item => item.product.id !== id));
  };

  const totalAmount = cart.reduce((sum, item) => sum + (item.product.price * item.qty), 0);
  const changeAmount = cashPaid > totalAmount ? cashPaid - totalAmount : 0;

  const handleCheckout = async () => {
    try {
      const batch = writeBatch(db);
      
      // Reduce Stock in Firestore
      cart.forEach(item => {
        const productRef = doc(db, 'products', item.product.id);
        batch.update(productRef, {
          stock: Math.max(0, item.product.stock - item.qty)
        });
      });

      // Save Order
      const ordersRef = collection(db, 'orders');
      await addDoc(ordersRef, {
        items: cart.map(i => ({ name: i.product.name, qty: i.qty, price: i.product.price })),
        total: totalAmount,
        cashPaid,
        change: changeAmount,
        createdAt: serverTimestamp()
      });

      await batch.commit();
      setCart([]);
      setCashPaid(0);
      setIsCartOpen(false);
      alert('Penjualan Berhasil Disimpan!');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'checkout');
    }
  };

  // Admin Actions
  const saveProduct = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get('name') as string,
      price: Number(formData.get('price')),
      stock: Number(formData.get('stock')),
      category: formData.get('category') as any,
      type: formData.get('type') as any,
      image: formData.get('image') as string || 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?q=80&w=400&h=400&auto=format&fit=crop',
      badge: formData.get('badge') as string,
      specs: (formData.get('specs') as string).split(',').map(s => s.trim()),
    };

    try {
      if (editingProduct) {
        const prodRef = doc(db, 'products', editingProduct.id);
        await updateDoc(prodRef, data);
      } else {
        await addDoc(collection(db, 'products'), data);
      }
      setIsFormOpen(false);
      setEditingProduct(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'products');
    }
  };

  const deleteProduct = async (id: string) => {
    if (confirm('Hapus produk ini?')) {
      try {
        await deleteDoc(doc(db, 'products', id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, 'products/' + id);
      }
    }
  };

  const sendWA = (product: Product) => {
    const phone = '6281357066070';
    const message = `Halo Roxy Cell Tanggul, saya tertarik dengan ${product.name} seharga ${formatIDR(product.price)}. Apakah stok masih ada? Bisa kredit Akulaku/Shopee?`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
  };

  return (
    <div className="min-h-screen flex flex-col bg-dark-bg text-gray-100 font-sans">
      
      {/* --- NAVBAR --- */}
      <nav className="glass-nav px-4 py-3 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-primary rounded-lg flex items-center justify-center shadow-lg shadow-primary/20">
              <Smartphone className="text-white w-5 h-5" />
            </div>
            <div className="hidden sm:block">
              <h1 className="font-display font-bold text-base leading-tight tracking-tight">ROXY CELL</h1>
              <p className="text-[9px] text-primary font-bold tracking-widest uppercase">Tanggul - Cloud POS</p>
            </div>
          </div>

          <div className="flex-1 max-w-md relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input 
              type="text" 
              placeholder="Cari produk di cloud..." 
              className="w-full bg-dark-card border border-white/10 rounded-full py-1.5 pl-9 pr-4 text-xs focus:outline-none focus:border-primary/50"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            {user ? (
               <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setIsAdminMode(!isAdminMode)}
                    className={`p-2 rounded-lg transition-colors ${isAdminMode ? 'bg-primary text-white' : 'bg-white/5 text-gray-400 hover:text-white'}`}
                  >
                    {isAdminMode ? <Lock className="w-5 h-5" /> : <Edit3 className="w-5 h-5" />}
                  </button>
                  <img src={user.photoURL || ''} className="w-8 h-8 rounded-full border border-white/10" />
                  <button onClick={logout} className="p-2 bg-white/5 rounded-lg text-red-400">
                    <LogOut className="w-5 h-5" />
                  </button>
               </div>
            ) : (
              <button 
                onClick={login}
                className="bg-white/5 hover:bg-white/10 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2"
              >
                <LogIn className="w-4 h-4" />
                Login
              </button>
            )}
            <button 
              onClick={() => setIsCartOpen(true)}
              className="p-2 bg-white/5 rounded-lg text-gray-400 hover:text-white relative"
            >
              <ShoppingCart className="w-5 h-5" />
              {cart.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-primary text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                  {cart.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </nav>

      <main className="flex-1 px-4 py-6 max-w-7xl mx-auto w-full">
        {/* Credit Info Bar */}
        <div className="flex flex-wrap gap-4 mb-8">
          <div className="flex items-center gap-3 bg-white/5 border border-white/5 p-3 rounded-2xl flex-1 min-w-[200px]">
            <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center text-red-500">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Sync Cloud</p>
              <p className="text-xs font-semibold">Data Tersimpan Aman di Firebase</p>
            </div>
          </div>
          <div className="flex items-center gap-3 bg-white/5 border border-white/5 p-3 rounded-2xl flex-1 min-w-[200px]">
            <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center text-green-500">
              <Box className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Layanan Toko</p>
              <p className="text-xs font-semibold">Cek Stok & Update Harga Realtime</p>
            </div>
          </div>
        </div>

        {isAdminMode && user && (
          <div className="mb-8 flex justify-end">
            <button 
              onClick={() => { setEditingProduct(null); setIsFormOpen(true); }}
              className="bg-primary hover:bg-primary-dark text-white px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-primary/20 transition-all active:scale-95"
            >
              <Plus className="w-5 h-5" />
              Tambah Produk Ke Cloud
            </button>
          </div>
        )}

        <div className="flex p-1 bg-dark-card border border-white/5 rounded-2xl mb-8 w-fit mx-auto sm:mx-0">
          <button 
            onClick={() => setActiveTab('hp')}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all ${activeTab === 'hp' ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'text-gray-500 hover:text-gray-300'}`}
          >
            <Smartphone className="w-4 h-4" />
            Handphone
          </button>
          <button 
            onClick={() => setActiveTab('ebike')}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all ${activeTab === 'ebike' ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'text-gray-500 hover:text-gray-300'}`}
          >
            <Bike className="w-4 h-4" />
            E-Bike
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          {filteredProducts.map((p) => (
            <motion.div 
              layout
              key={p.id} 
              className="bg-dark-card rounded-2xl border border-white/5 overflow-hidden flex flex-col group relative"
            >
              {isAdminMode && user && (
                <div className="absolute top-2 right-2 z-10 flex gap-2">
                  <button 
                    onClick={() => { setEditingProduct(p); setIsFormOpen(true); }}
                    className="p-1.5 bg-blue-600 rounded-lg text-white shadow-lg"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button 
                    onClick={() => deleteProduct(p.id)}
                    className="p-1.5 bg-red-600 rounded-lg text-white shadow-lg"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <div className="aspect-square bg-gray-900 relative">
                <img src={p.image} alt={p.name} className="w-full h-full object-cover" />
                {p.badge && (
                  <div className="absolute top-2 left-2 bg-primary text-[9px] font-bold px-2 py-0.5 rounded-md">
                    {p.badge}
                  </div>
                )}
                <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded flex items-center gap-1.5">
                  <Box className="w-3 h-3 text-primary" />
                  <span className={`text-[10px] font-bold ${p.stock <= 1 ? 'text-red-400' : 'text-white'}`}>
                    Stok: {p.stock}
                  </span>
                </div>
              </div>

              <div className="p-4 flex-1 flex flex-col">
                <h3 className="font-bold text-xs md:text-sm mb-1 line-clamp-2 h-8 md:h-10 leading-snug">{p.name}</h3>
                <div className="mb-4">
                  <p className="text-primary font-bold text-sm md:text-base">{formatIDR(p.price)}</p>
                  {p.originalPrice && (
                    <span className="text-[10px] text-gray-500 line-through">{formatIDR(p.originalPrice)}</span>
                  )}
                </div>

                <div className="space-y-1.5 mb-4 flex-1">
                  {p.specs.slice(0, 2).map((s, i) => (
                    <p key={i} className="text-[10px] text-gray-500 flex items-center gap-1.5">
                      <Zap className="w-3 h-3 shrink-0" />
                      {s}
                    </p>
                  ))}
                  <div className="flex gap-2 mt-2">
                    <img src="https://img.icons8.com/color/48/000000/shopee.png" className="w-3 h-3 md:w-4 md:h-4 opacity-50 grayscale hover:grayscale-0 transition-all" title="Bisa Shopee Pinjam" />
                    <span className="text-[8px] border border-white/10 px-1.5 rounded text-gray-600 uppercase font-bold whitespace-nowrap">Akulaku Ready</span>
                  </div>
                </div>

                {isAdminMode && user && (
                  <div className="flex items-center justify-between mb-4 bg-white/5 p-2 rounded-xl border border-white/5">
                    <button onClick={() => updateStock(p.id, -1)} className="p-1 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                    <span className="text-xs font-bold">Stok: {p.stock}</span>
                    <button onClick={() => updateStock(p.id, 1)} className="p-1 hover:bg-green-500/20 text-green-400 rounded-lg transition-colors"><Plus className="w-4 h-4" /></button>
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <button 
                    onClick={() => addToCart(p)}
                    className="w-full bg-white/5 hover:bg-white/10 text-white py-2 rounded-xl text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Beli / Jual
                  </button>
                  <button 
                    onClick={() => sendWA(p)}
                    className="w-full bg-[#25D366] hover:bg-[#128C7E] text-white py-2 rounded-xl text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    WA Admin
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </main>

      {/* --- CART / POS DRAWER --- */}
      <AnimatePresence>
        {isCartOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsCartOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
            />
            <motion.div 
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              className="fixed right-0 top-0 h-full w-full max-w-md bg-dark-card border-l border-white/5 z-[70] shadow-2xl flex flex-col"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Calculator className="text-primary w-6 h-6" />
                  <h3 className="text-xl font-display font-bold">Kasir Online</h3>
                </div>
                <button onClick={() => setIsCartOpen(false)} className="p-2 hover:bg-white/5 rounded-full"><X className="w-6 h-6" /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {cart.length === 0 ? (
                  <div className="text-center py-20 text-gray-500">
                    <ShoppingCart className="w-12 h-12 mx-auto mb-4 opacity-10" />
                    <p>Antrian Kasir Kosong</p>
                  </div>
                ) : (
                  cart.map((item) => (
                    <div key={item.product.id} className="flex gap-4 p-3 bg-white/5 rounded-2xl border border-white/5">
                      <img src={item.product.image} className="w-12 h-12 rounded-lg object-cover" />
                      <div className="flex-1">
                        <p className="text-xs font-bold leading-tight">{item.product.name}</p>
                        <p className="text-[10px] text-primary font-bold mt-1">{formatIDR(item.product.price)} x {item.qty}</p>
                      </div>
                      <button onClick={() => removeFromCart(item.product.id)} className="text-red-500 p-1"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))
                )}
              </div>

              {cart.length > 0 && (
                <div className="p-6 bg-dark-bg border-t border-white/5 space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Total</span>
                      <span className="font-bold text-lg text-primary">{formatIDR(totalAmount)}</span>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">Tunai</label>
                      <input 
                        type="number" 
                        className="w-full bg-dark-card border border-white/10 rounded-xl py-3 px-4 text-xl font-display font-bold focus:outline-none focus:border-primary"
                        value={cashPaid || ''}
                        onChange={(e) => setCashPaid(Number(e.target.value))}
                      />
                    </div>
                    <div className="flex justify-between text-sm pt-2">
                       <span className="text-gray-400">Kembalian</span>
                       <span className={`font-bold ${changeAmount > 0 ? 'text-green-400' : 'text-gray-600'}`}>{formatIDR(changeAmount)}</span>
                    </div>
                  </div>
                  <button 
                    onClick={handleCheckout}
                    className="w-full bg-primary hover:bg-primary-dark text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-3 shadow-xl shadow-primary/20 transition-all active:scale-95"
                  >
                    Simpan Penjualan Ke Cloud
                  </button>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* --- FORM MODAL --- */}
      <AnimatePresence>
        {isFormOpen && (
          <div className="fixed inset-0 flex items-center justify-center z-[100] p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsFormOpen(false)} className="fixed inset-0 bg-black/80 backdrop-blur-md" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="bg-dark-card border border-white/10 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl relative z-10">
              <div className="p-6 border-b border-white/5 flex justify-between items-center">
                <h3 className="text-xl font-bold">{editingProduct ? 'Edit Dari Cloud' : 'Tambah Ke Cloud'}</h3>
                <button onClick={() => setIsFormOpen(false)}><X /></button>
              </div>
              <form onSubmit={saveProduct} className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Nama Produk</label>
                    <input name="name" defaultValue={editingProduct?.name} required className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-primary" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase">Harga</label>
                      <input name="price" type="number" defaultValue={editingProduct?.price} required className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-primary" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase">Stok</label>
                      <input name="stock" type="number" defaultValue={editingProduct?.stock} required className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-primary" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase">URL Gambar</label>
                    <div className="flex gap-2">
                      <input name="image" defaultValue={editingProduct?.image} className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-primary" />
                      <button 
                        type="button"
                        disabled={isGeneratingImage}
                        onClick={generateAIImage}
                        className="bg-primary/20 hover:bg-primary/30 border border-primary/30 text-primary px-3 rounded-xl flex items-center gap-2 transition-all disabled:opacity-50"
                      >
                        {isGeneratingImage ? <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" /> : <Zap className="w-4 h-4" />}
                        <span className="text-[10px] font-bold">AI</span>
                      </button>
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase">Kategori</label>
                      <select name="category" defaultValue={editingProduct?.category} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-primary">
                        <option value="hp">Handphone</option>
                        <option value="ebike">E-Bike</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase">Tipe</label>
                      <select name="type" defaultValue={editingProduct?.type} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-primary">
                        <option value="baru">Baru</option>
                        <option value="bekas">Bekas</option>
                        <option value="ebike">E-Bike</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Spesifikasi (Koma)</label>
                    <textarea name="specs" defaultValue={editingProduct?.specs.join(', ')} rows={3} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-primary" />
                  </div>
                </div>
                <button type="submit" className="md:col-span-2 w-full bg-primary py-4 rounded-2xl font-bold">Simpan Sinkronisasi</button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <footer className="p-8 text-center border-t border-white/5 bg-black/20">
        <p className="text-xs text-gray-500 italic block mb-4">"Cloud-Synced POS for Roxy Cell Tanggul"</p>
        <div className="flex justify-center gap-4 text-xs font-bold text-primary tracking-widest uppercase">
          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> TANGGUL</span>
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> 09:00 - 21:00</span>
        </div>
      </footer>
    </div>
  );
}
