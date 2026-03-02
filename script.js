
const state = {
  categories: [],
  adminCategories: [],
  products: [],
  favorites: [],
  adminProducts: [],
  adminUsers: [],
  adminOrders: [],
  adminStockReport: [],
  adminStockMovements: [],
  adminCoupons: [],
  cart: [],
  settings: null,
  shipping: { cost: 0, days: 0 },
  discount: { value: 0, code: null },
  payment: { method: 'pix', installments: 1, cashChangeFor: null, proof: '' },
  lastOrderWhatsappText: null,
  token: localStorage.getItem('moreno_token') || null,
  user: JSON.parse(localStorage.getItem('moreno_user') || 'null')
};

const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';

const sections = {
  products: document.getElementById('productsSection'),
  favorites: document.getElementById('favoritesSection'),
  auth: document.getElementById('authSection'),
  admin: document.getElementById('adminSection'),
  orders: document.getElementById('ordersSection')
};

const navButtonsBySection = {
  products: 'btnProducts',
  favorites: 'btnFavorites',
  auth: 'btnAuth',
  admin: 'btnAdmin',
  orders: 'btnOrders'
};

function money(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function setFeedback(id, message, type = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `feedback ${type}`.trim();
  el.textContent = message;
}

function normalizeInstagramUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'https://instagram.com';
  if (/^https?:\/\//i.test(raw)) return raw;
  const username = raw.startsWith('@') ? raw.slice(1) : raw;
  return `https://instagram.com/${username}`;
}

function normalizeTelHref(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? `tel:+${digits}` : '#';
}

function normalizeMailHref(value) {
  const email = String(value || '').trim();
  return email ? `mailto:${email}` : '#';
}

function normalizeWhatsappUrl(phone, text = '') {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '#';
  const encoded = encodeURIComponent(text || 'Olá, quero falar com a loja.');
  return `https://wa.me/${digits}?text=${encoded}`;
}

function getPaymentMethodLabel(method) {
  if (method === 'cash') return 'Dinheiro';
  if (method === 'credit') return `Cartão de crédito (${state.payment.installments}x)`;
  if (method === 'debit') return 'Cartão de débito';
  return 'PIX';
}

function getPaymentMethodLabelByOrder(order) {
  if (order.payment_method === 'cash') return 'Dinheiro';
  if (order.payment_method === 'credit') return `Crédito${order.payment_installments > 1 ? ` (${order.payment_installments}x)` : ''}`;
  if (order.payment_method === 'debit') return 'Débito';
  return 'PIX';
}

function updatePaymentUI() {
  const wrapInstallments = document.getElementById('creditInstallmentsWrap');
  const wrapCash = document.getElementById('cashChangeWrap');
  const wrapProof = document.getElementById('paymentProofWrap');
  const summary = document.getElementById('paymentSummary');

  document.querySelectorAll('.payment-option').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.method === state.payment.method);
  });

  wrapInstallments.classList.toggle('hidden', state.payment.method !== 'credit');
  wrapCash.classList.toggle('hidden', state.payment.method !== 'cash');
  wrapProof.classList.toggle('hidden', state.payment.method === 'cash');
  summary.textContent = `Pagamento selecionado: ${getPaymentMethodLabel(state.payment.method)}`;
}

function setupPaymentOptions() {
  document.querySelectorAll('.payment-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.payment.method = btn.dataset.method;
      updatePaymentUI();
    });
  });

  document.getElementById('creditInstallments').addEventListener('change', (e) => {
    state.payment.installments = Number(e.target.value || 1);
    updatePaymentUI();
  });

  document.getElementById('cashChangeFor').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    state.payment.cashChangeFor = Number.isFinite(v) && v > 0 ? v : null;
  });

  document.getElementById('paymentProof').addEventListener('input', (e) => {
    state.payment.proof = String(e.target.value || '');
  });

  updatePaymentUI();
}

function showSection(name) {
  Object.values(sections).forEach((section) => section.classList.add('hidden'));
  sections[name].classList.remove('hidden');
  Object.entries(navButtonsBySection).forEach(([sectionName, btnId]) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.classList.toggle('is-active', sectionName === name);
  });
}

function saveSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('moreno_token', token);
  localStorage.setItem('moreno_user', JSON.stringify(user));
  refreshUIByRole();
}

function clearSession() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('moreno_token');
  localStorage.removeItem('moreno_user');
  refreshUIByRole();
}

function refreshUIByRole() {
  const isAdmin = state.user?.role === 'admin';
  document.getElementById('btnAdmin').classList.toggle('hidden', !isAdmin);
  document.getElementById('logoutLabel').textContent = state.user ? `Sair (${state.user.name.split(' ')[0]})` : 'Sair';
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new Error('Servidor offline.');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Falha na requisição.');
  return data;
}

function applyContactSettings(settings) {
  const phone = settings?.phone || '-';
  const instagram = settings?.instagram || '-';
  const email = settings?.email || '-';

  document.getElementById('footerPhone').textContent = phone;
  document.getElementById('footerInstagram').textContent = instagram;
  document.getElementById('footerEmail').textContent = email;
  document.getElementById('footerInstagramLink').href = normalizeInstagramUrl(instagram);
  document.getElementById('footerEmailLink').href = normalizeMailHref(email);

  document.getElementById('heroTitle').textContent = settings?.heroTitle || 'Design, conforto e qualidade para seu lar.';
  document.getElementById('heroSubtitle').textContent = settings?.heroSubtitle || 'Loja online oficial da Moreno Móveis.';
  document.getElementById('heroBannerText').textContent = settings?.bannerText || '';
  document.getElementById('tickerItemBanner').textContent = settings?.bannerText || 'Frete grátis em Paulo de Faria e Orindiúva';

  document.getElementById('heroPhoneLink').textContent = phone;
  document.getElementById('heroPhoneLink').href = normalizeTelHref(phone);
  document.getElementById('heroInstagramLink').textContent = instagram;
  document.getElementById('heroInstagramLink').href = normalizeInstagramUrl(instagram);
  document.getElementById('heroEmailLink').textContent = email;
  document.getElementById('heroEmailLink').href = normalizeMailHref(email);

  document.getElementById('floatingWhatsappLink').href = normalizeWhatsappUrl(phone);
  document.getElementById('floatingInstagramLink').href = normalizeInstagramUrl(instagram);

  const adminFields = ['adminPhone', 'adminInstagram', 'adminEmail', 'adminHeroTitle', 'adminHeroSubtitle', 'adminBannerText'];
  if (adminFields.every((id) => document.getElementById(id))) {
    document.getElementById('adminPhone').value = settings?.phone || '';
    document.getElementById('adminInstagram').value = settings?.instagram || '';
    document.getElementById('adminEmail').value = settings?.email || '';
    document.getElementById('adminHeroTitle').value = settings?.heroTitle || '';
    document.getElementById('adminHeroSubtitle').value = settings?.heroSubtitle || '';
    document.getElementById('adminBannerText').value = settings?.bannerText || '';
  }
}

async function loadSettings() {
  state.settings = await api('/api/settings');
  applyContactSettings(state.settings);
}

function getFilters() {
  return {
    search: document.getElementById('searchProduct').value,
    category: document.getElementById('filterCategory').value,
    minPrice: document.getElementById('filterMinPrice').value,
    maxPrice: document.getElementById('filterMaxPrice').value,
    inStock: document.getElementById('filterInStock').checked ? '1' : '',
    featured: document.getElementById('filterFeatured').checked ? '1' : ''
  };
}

function calcSubtotal() {
  return state.cart.reduce((sum, i) => sum + i.quantity * Number(i.product.price), 0);
}

function calcTotal() {
  const subtotal = calcSubtotal();
  return Math.max(0, subtotal - state.discount.value + state.shipping.cost);
}

function updateTotals() {
  document.getElementById('cartSubtotal').textContent = money(calcSubtotal());
  document.getElementById('shippingCost').textContent = money(state.shipping.cost);
  document.getElementById('shippingDays').textContent = state.shipping.days ? `(${state.shipping.days} dias)` : '';
  document.getElementById('discountValue').textContent = money(state.discount.value);
  document.getElementById('cartTotal').textContent = money(calcTotal());
}

function renderCategoryFilter() {
  const select = document.getElementById('filterCategory');
  const categories = state.categories.length
    ? state.categories.map((c) => c.name)
    : Array.from(new Set(state.products.map((p) => p.category).filter(Boolean))).sort();
  const current = select.value;
  select.innerHTML = '<option value="">Todas</option>';
  categories.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  });
  select.value = current;
}

function populateAdminCategorySelect() {
  const select = document.getElementById('adminCategory');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">Selecione</option>';
  state.adminCategories
    .filter((c) => c.active)
    .forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.name;
      opt.textContent = c.name;
      select.appendChild(opt);
    });
  select.value = current;
}

function buildProductCard(product, withFavorite = true) {
  const fav = state.favorites.some((f) => f.id === product.id);
  const rating = product.avg_rating ? `⭐ ${product.avg_rating} (${product.total_reviews})` : 'Sem avaliações';
  const oldPrice = product.old_price ? `<span class="old-price">${money(product.old_price)}</span>` : '';

  return `
    <article class="card product-card" data-id="${product.id}">
      <img src="${escapeHtml(product.image_url || 'https://images.unsplash.com/photo-1581539250439-c96689b516dd')}" alt="${escapeHtml(product.name)}" />
      <h3>${escapeHtml(product.name)}</h3>
      <p>${escapeHtml(product.description)}</p>
      <p>
        ${product.featured ? '<span class="badge">Destaque</span>' : ''}
        <span class="badge">${escapeHtml(product.category || 'Móveis')}</span>
        <span class="badge">Estoque: ${product.stock}</span>
      </p>
      <p class="price">${oldPrice} ${money(product.price)}</p>
      <p class="muted">${rating}</p>
      <p class="muted">Entrega: Paulo de Faria, Orindiúva e São José do Rio Preto</p>
      <p class="muted">Frete grátis em Paulo de Faria e Orindiúva + montagem/instalação sem custo.</p>
      <div class="row-actions">
        <button class="btn primary add-cart-btn" ${product.stock <= 0 ? 'disabled' : ''}>${product.stock <= 0 ? 'Sem estoque' : 'Adicionar'}</button>
        ${withFavorite ? `<button class="btn light fav-btn">${fav ? 'Desfavoritar' : 'Favoritar'}</button>` : ''}
      </div>
      <details>
        <summary>Avaliações</summary>
        <div class="reviews" id="reviews-${product.id}">Carregando...</div>
        <div class="inline-form" style="margin-top:8px;">
          <input type="number" min="1" max="5" id="rating-${product.id}" placeholder="Nota 1-5" />
          <input id="comment-${product.id}" placeholder="Comentário" />
          <button class="btn light review-btn">Enviar</button>
        </div>
      </details>
    </article>
  `;
}

async function loadProducts() {
  const q = new URLSearchParams(getFilters()).toString();
  state.products = await api(`/api/products?${q}`);
  renderCategoryFilter();
  renderProducts();
}

function bindProductCardEvents(container) {
  container.querySelectorAll('.product-card').forEach((card) => {
    const id = Number(card.dataset.id);
    const product = state.products.find((p) => p.id === id) || state.favorites.find((p) => p.id === id);
    if (!product) return;

    card.querySelector('.add-cart-btn')?.addEventListener('click', () => addToCart(product));
    card.querySelector('.fav-btn')?.addEventListener('click', () => toggleFavorite(product.id));
    card.querySelector('.review-btn')?.addEventListener('click', async () => {
      const rating = Number(document.getElementById(`rating-${id}`).value);
      const comment = document.getElementById(`comment-${id}`).value;
      try {
        if (!state.user) throw new Error('Faça login para avaliar.');
        await api(`/api/products/${id}/reviews`, { method: 'POST', body: JSON.stringify({ rating, comment }) });
        await loadProductReviews(id);
      } catch (error) {
        setFeedback('checkoutFeedback', error.message, 'error');
      }
    });

    loadProductReviews(id);
  });
}

async function loadProductReviews(productId) {
  const box = document.getElementById(`reviews-${productId}`);
  if (!box) return;
  const reviews = await api(`/api/products/${productId}/reviews`);
  if (!reviews.length) {
    box.innerHTML = '<p>Sem avaliações.</p>';
    return;
  }
  box.innerHTML = reviews.map((r) => `<p><strong>${escapeHtml(r.user_name)}</strong> (${r.rating}/5): ${escapeHtml(r.comment || '')}</p>`).join('');
}

function renderProducts() {
  const grid = document.getElementById('productsGrid');
  if (!state.products.length) {
    grid.innerHTML = '<p>Nenhum produto encontrado.</p>';
    return;
  }
  const grouped = state.products.reduce((acc, product) => {
    const categoryName = product.category || 'Sem categoria';
    if (!acc[categoryName]) acc[categoryName] = [];
    acc[categoryName].push(product);
    return acc;
  }, {});

  const orderedCategories = Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  grid.innerHTML = orderedCategories.map((categoryName) => `
    <section class="category-group">
      <h3 class="section-title" style="font-size:1.1rem; margin-bottom:8px;">${escapeHtml(categoryName)}</h3>
      <div class="products-grid">
        ${grouped[categoryName].map((p) => buildProductCard(p)).join('')}
      </div>
    </section>
  `).join('');
  bindProductCardEvents(grid);
}

function renderFavorites() {
  const grid = document.getElementById('favoritesGrid');
  if (!state.user) {
    grid.innerHTML = '<p>Faça login para usar favoritos.</p>';
    return;
  }
  if (!state.favorites.length) {
    grid.innerHTML = '<p>Nenhum favorito ainda.</p>';
    return;
  }
  grid.innerHTML = state.favorites.map((p) => buildProductCard(p)).join('');
  bindProductCardEvents(grid);
}

async function loadFavorites() {
  if (!state.user) {
    state.favorites = [];
    renderFavorites();
    return;
  }
  state.favorites = await api('/api/favorites');
  renderFavorites();
}

async function toggleFavorite(productId) {
  if (!state.user) {
    setFeedback('checkoutFeedback', 'Faça login para favoritar.', 'error');
    return;
  }
  const exists = state.favorites.some((f) => f.id === productId);
  if (exists) {
    await api(`/api/favorites/${productId}`, { method: 'DELETE' });
  } else {
    await api(`/api/favorites/${productId}`, { method: 'POST' });
  }
  await loadFavorites();
  renderProducts();
}

function addToCart(product) {
  if (Number(product.stock) <= 0) return setFeedback('checkoutFeedback', 'Produto sem estoque.', 'error');
  const existing = state.cart.find((item) => item.product.id === product.id);
  if (existing) {
    if (existing.quantity + 1 > product.stock) return setFeedback('checkoutFeedback', 'Quantidade indisponível.', 'error');
    existing.quantity += 1;
  } else {
    state.cart.push({ product, quantity: 1 });
  }
  renderCart();
}

function removeFromCart(productId) {
  state.cart = state.cart.filter((item) => item.product.id !== productId);
  renderCart();
}

function renderCart() {
  const cartList = document.getElementById('cartList');
  if (!state.cart.length) cartList.innerHTML = '<p>Carrinho vazio.</p>';
  else {
    cartList.innerHTML = state.cart.map((item) => `
      <div class="cart-item">
        <div><strong>${escapeHtml(item.product.name)}</strong><br />Qtd: ${item.quantity}</div>
        <div>${money(item.quantity * item.product.price)} <button class="btn light remove-cart" data-id="${item.product.id}">X</button></div>
      </div>
    `).join('');

    cartList.querySelectorAll('.remove-cart').forEach((btn) => {
      btn.addEventListener('click', () => removeFromCart(Number(btn.dataset.id)));
    });
  }
  updateTotals();
}

async function handleRegister() {
  try {
    const body = {
      name: document.getElementById('regName').value,
      email: document.getElementById('regEmail').value,
      password: document.getElementById('regPassword').value,
      phone: document.getElementById('regPhone').value,
      cpf: document.getElementById('regCpf').value,
      birthDate: document.getElementById('regBirthDate').value,
      zipCode: document.getElementById('regZip').value,
      street: document.getElementById('regStreet').value,
      number: document.getElementById('regNumber').value,
      complement: document.getElementById('regComplement').value,
      neighborhood: document.getElementById('regNeighborhood').value,
      city: document.getElementById('regCity').value,
      state: document.getElementById('regState').value
    };
    await api('/api/auth/register', { method: 'POST', body: JSON.stringify(body) });
    setFeedback('registerFeedback', 'Conta criada com sucesso.', 'success');
  } catch (error) {
    setFeedback('registerFeedback', error.message, 'error');
  }
}

async function handleLogin() {
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: document.getElementById('loginEmail').value, password: document.getElementById('loginPassword').value })
    });
    saveSession(data.token, data.user);
    setFeedback('loginFeedback', 'Login realizado com sucesso.', 'success');
    await loadFavorites();
    showSection('products');
  } catch (error) {
    setFeedback('loginFeedback', error.message, 'error');
  }
}

async function handleForgotPassword() {
  try {
    const data = await api('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: document.getElementById('forgotEmail').value })
    });
    if (data.resetToken) document.getElementById('resetToken').value = data.resetToken;
    setFeedback('resetFeedback', data.message, 'success');
  } catch (error) {
    setFeedback('resetFeedback', error.message, 'error');
  }
}

async function handleResetPassword() {
  try {
    const data = await api('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token: document.getElementById('resetToken').value, newPassword: document.getElementById('resetPassword').value })
    });
    setFeedback('resetFeedback', data.message, 'success');
  } catch (error) {
    setFeedback('resetFeedback', error.message, 'error');
  }
}

async function handleCalcShipping() {
  try {
    const shippingCity = document.getElementById('shippingCity').value;
    if (!shippingCity) throw new Error('Selecione a cidade de entrega.');
    const data = await api('/api/shipping/calculate', {
      method: 'POST',
      body: JSON.stringify({
        zipCode: document.getElementById('shippingZip').value,
        shippingCity,
        subtotal: calcSubtotal() - state.discount.value
      })
    });
    state.shipping = { cost: Number(data.cost || 0), days: Number(data.days || 0) };
    updateTotals();
  } catch (error) {
    setFeedback('checkoutFeedback', error.message, 'error');
  }
}

async function handleApplyCoupon() {
  try {
    const data = await api('/api/coupons/validate', {
      method: 'POST',
      body: JSON.stringify({ subtotal: calcSubtotal(), couponCode: document.getElementById('couponCode').value })
    });
    if (!data.valid) throw new Error(data.message || 'Cupom inválido.');
    state.discount = { value: Number(data.discount || 0), code: data.code };
    updateTotals();
    setFeedback('checkoutFeedback', `Cupom ${data.code} aplicado.`, 'success');
  } catch (error) {
    state.discount = { value: 0, code: null };
    updateTotals();
    setFeedback('checkoutFeedback', error.message, 'error');
  }
}

async function createOrder(paymentMethodOverride) {
  const paymentMethod = paymentMethodOverride || state.payment.method;
  const shippingCity = document.getElementById('shippingCity').value;
  const shippingZip = document.getElementById('shippingZip').value;
  const shippingStreet = document.getElementById('deliveryStreet').value;
  const shippingNumber = document.getElementById('deliveryNumber').value;
  const shippingComplement = document.getElementById('deliveryComplement').value;
  const shippingNeighborhood = document.getElementById('deliveryNeighborhood').value;
  const shippingState = document.getElementById('deliveryState').value;

  if (!shippingCity) throw new Error('Selecione a cidade de entrega.');
  if (!shippingZip || !shippingStreet || !shippingNumber || !shippingNeighborhood || !shippingState) {
    throw new Error('Preencha o endereço completo para entrega.');
  }

  return api('/api/orders', {
    method: 'POST',
    body: JSON.stringify({
      paymentMethod,
      paymentInstallments: paymentMethod === 'credit' ? state.payment.installments : 1,
      cashChangeFor: paymentMethod === 'cash' ? state.payment.cashChangeFor : null,
      paymentProof: paymentMethod === 'cash' ? null : state.payment.proof,
      couponCode: state.discount.code,
      shippingZip,
      shippingCity,
      shippingStreet,
      shippingNumber,
      shippingComplement,
      shippingNeighborhood,
      shippingState,
      items: state.cart.map((i) => ({ productId: i.product.id, quantity: i.quantity }))
    })
  });
}

async function handleCheckout() {
  if (!state.user) return setFeedback('checkoutFeedback', 'Faça login para finalizar.', 'error');
  if (!state.cart.length) return setFeedback('checkoutFeedback', 'Carrinho vazio.', 'error');

  try {
    const orderResponse = await createOrder();
    state.lastOrderWhatsappText = orderResponse.whatsappText || null;
    const url = normalizeWhatsappUrl(state.settings?.phone, orderResponse.whatsappText);
    window.open(url, '_blank', 'noopener');
    setFeedback('checkoutFeedback', 'Pedido enviado para o WhatsApp da loja. A venda será fechada por lá.', 'success');

    state.cart = [];
    state.discount = { value: 0, code: null };
    state.payment.cashChangeFor = null;
    state.payment.proof = '';
    document.getElementById('cashChangeFor').value = '';
    document.getElementById('paymentProof').value = '';
    renderCart();
    await loadProducts();
    await loadMyOrders();
  } catch (error) {
    setFeedback('checkoutFeedback', error.message, 'error');
  }
}

function handleResendLastOrderWhatsapp() {
  if (!state.lastOrderWhatsappText) {
    setFeedback('checkoutFeedback', 'Nenhum pedido recente para reenviar.', 'error');
    return;
  }
  const url = normalizeWhatsappUrl(state.settings?.phone, state.lastOrderWhatsappText);
  window.open(url, '_blank', 'noopener');
}

async function loadMyOrders() {
  const ordersList = document.getElementById('ordersList');
  ordersList.innerHTML = '<p>Faça login para visualizar seus pedidos.</p>';
  if (!state.user) return;

  try {
    const orders = await api('/api/orders/my');
    if (!orders.length) {
      ordersList.innerHTML = '<p>Nenhum pedido ainda.</p>';
      return;
    }

    ordersList.innerHTML = orders.map((order) => {
      const itemsHtml = order.items.map((item) => `<div class="order-item"><span>${escapeHtml(item.product_name)} (x${item.quantity})</span><strong>${money(item.quantity * item.unit_price)}</strong></div>`).join('');
      const historyHtml = (order.history || []).map((h) => `<span class="badge">${escapeHtml(h.status)}</span>`).join(' ');
      return `
        <div class="card" style="margin-bottom:10px;">
          <p><strong>Pedido #${order.id}</strong> - ${new Date(order.created_at).toLocaleString('pt-BR')}</p>
          <p>${historyHtml}</p>
          <p><strong>Pagamento:</strong> ${escapeHtml(getPaymentMethodLabelByOrder(order))}</p>
          <p><strong>Comprovante:</strong> ${escapeHtml(order.payment_proof || 'Não informado')}</p>
          <p><strong>Entrega:</strong> ${escapeHtml(order.shipping_street || '')}, ${escapeHtml(order.shipping_number || '')} - ${escapeHtml(order.shipping_neighborhood || '')}, ${escapeHtml(order.shipping_city || '')}/${escapeHtml(order.shipping_state || '')} ${order.shipping_zip ? `- CEP ${escapeHtml(order.shipping_zip)}` : ''}</p>
          <p><strong>Subtotal:</strong> ${money(order.subtotal)} | <strong>Desconto:</strong> ${money(order.discount_total)} | <strong>Frete:</strong> ${money(order.shipping_cost)}</p>
          <p><strong>Total:</strong> ${money(order.total)}</p>
          ${itemsHtml}
        </div>
      `;
    }).join('');
  } catch (error) {
    ordersList.innerHTML = `<p class="feedback error">${error.message}</p>`;
  }
}

function fillProductForm(product) {
  document.getElementById('adminProductId').value = product.id;
  document.getElementById('adminName').value = product.name || '';
  document.getElementById('adminCategory').value = product.category || '';
  document.getElementById('adminPrice').value = product.price || '';
  document.getElementById('adminOldPrice').value = product.old_price || '';
  document.getElementById('adminStock').value = product.stock || 0;
  document.getElementById('adminImage').value = product.image_url || '';
  document.getElementById('adminFeatured').value = product.featured ? '1' : '0';
  document.getElementById('adminDescription').value = product.description || '';
}

function clearProductForm() {
  document.getElementById('adminProductId').value = '';
  ['adminName', 'adminCategory', 'adminPrice', 'adminOldPrice', 'adminStock', 'adminImage', 'adminDescription'].forEach((id) => document.getElementById(id).value = '');
  document.getElementById('adminFeatured').value = '0';
  document.getElementById('adminCategory').value = '';
}

async function saveProduct() {
  try {
    const id = document.getElementById('adminProductId').value;
    const body = {
      name: document.getElementById('adminName').value,
      category: document.getElementById('adminCategory').value,
      price: Number(document.getElementById('adminPrice').value),
      oldPrice: document.getElementById('adminOldPrice').value,
      stock: Number(document.getElementById('adminStock').value),
      imageUrl: document.getElementById('adminImage').value,
      featured: document.getElementById('adminFeatured').value === '1',
      description: document.getElementById('adminDescription').value
    };

    if (id) await api(`/api/products/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/api/products', { method: 'POST', body: JSON.stringify(body) });

    setFeedback('adminFeedback', 'Produto salvo com sucesso.', 'success');
    clearProductForm();
    await loadProducts();
    await loadAdminProducts();
  } catch (error) {
    setFeedback('adminFeedback', error.message, 'error');
  }
}

async function removeProduct(id) {
  try {
    await api(`/api/products/${id}`, { method: 'DELETE' });
    setFeedback('adminFeedback', 'Produto removido.', 'success');
    await loadProducts();
    await loadAdminProducts();
  } catch (error) {
    setFeedback('adminFeedback', error.message, 'error');
  }
}

async function loadAdminProducts() {
  if (state.user?.role !== 'admin') return;
  state.adminProducts = await api('/api/admin/products');
  const container = document.getElementById('adminProductsList');
  container.innerHTML = state.adminProducts.map((p) => `
    <div class="admin-product-item">
      <div><strong>${escapeHtml(p.name)}</strong> <span class="badge">${p.active ? 'Ativo' : 'Inativo'}</span></div>
      <div class="row-actions">
        <button class="btn light edit-product" data-id="${p.id}">Editar</button>
        <button class="btn danger remove-product" data-id="${p.id}">Remover</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.edit-product').forEach((btn) => {
    btn.addEventListener('click', () => fillProductForm(state.adminProducts.find((p) => p.id === Number(btn.dataset.id))));
  });
  container.querySelectorAll('.remove-product').forEach((btn) => {
    btn.addEventListener('click', () => removeProduct(Number(btn.dataset.id)));
  });
}

async function loadCategories() {
  state.categories = await api('/api/categories');
  renderCategoryFilter();
}

async function createCategory() {
  try {
    const name = document.getElementById('adminCategoryName').value;
    await api('/api/admin/categories', { method: 'POST', body: JSON.stringify({ name }) });
    document.getElementById('adminCategoryName').value = '';
    setFeedback('adminCategoryFeedback', 'Categoria criada com sucesso.', 'success');
    await loadCategories();
    await loadAdminCategories();
  } catch (error) {
    setFeedback('adminCategoryFeedback', error.message, 'error');
  }
}

async function deactivateCategory(id) {
  try {
    await api(`/api/admin/categories/${id}`, { method: 'DELETE' });
    setFeedback('adminCategoryFeedback', 'Categoria desativada.', 'success');
    await loadCategories();
    await loadAdminCategories();
  } catch (error) {
    setFeedback('adminCategoryFeedback', error.message, 'error');
  }
}

async function loadAdminCategories() {
  if (state.user?.role !== 'admin') return;
  state.adminCategories = await api('/api/admin/categories');
  populateAdminCategorySelect();

  const box = document.getElementById('adminCategoriesList');
  if (!state.adminCategories.length) {
    box.innerHTML = '<p>Nenhuma categoria cadastrada.</p>';
    return;
  }

  box.innerHTML = state.adminCategories.map((c) => `
    <div class="admin-product-item">
      <div>
        <strong>${escapeHtml(c.name)}</strong>
        <span class="badge">${c.active ? 'Ativa' : 'Inativa'}</span>
      </div>
      <div class="row-actions">
        ${c.active ? `<button class="btn danger remove-category" data-id="${c.id}">Desativar</button>` : ''}
      </div>
    </div>
  `).join('');

  box.querySelectorAll('.remove-category').forEach((btn) => {
    btn.addEventListener('click', () => deactivateCategory(Number(btn.dataset.id)));
  });
}

async function saveSettings() {
  try {
    const payload = {
      phone: document.getElementById('adminPhone').value,
      instagram: document.getElementById('adminInstagram').value,
      email: document.getElementById('adminEmail').value,
      heroTitle: document.getElementById('adminHeroTitle').value,
      heroSubtitle: document.getElementById('adminHeroSubtitle').value,
      bannerText: document.getElementById('adminBannerText').value
    };
    const response = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(payload) });
    state.settings = response.settings;
    applyContactSettings(state.settings);
    setFeedback('settingsFeedback', 'Configurações salvas.', 'success');
  } catch (error) {
    setFeedback('settingsFeedback', error.message, 'error');
  }
}

async function createCoupon() {
  try {
    const body = {
      code: document.getElementById('couponAdminCode').value,
      type: document.getElementById('couponAdminType').value,
      value: Number(document.getElementById('couponAdminValue').value),
      minTotal: Number(document.getElementById('couponAdminMinTotal').value || 0),
      expiresAt: document.getElementById('couponAdminExpires').value || null
    };
    await api('/api/admin/coupons', { method: 'POST', body: JSON.stringify(body) });
    setFeedback('couponAdminFeedback', 'Cupom criado.', 'success');
    await loadAdminCoupons();
  } catch (error) {
    setFeedback('couponAdminFeedback', error.message, 'error');
  }
}

async function loadAdminCoupons() {
  if (state.user?.role !== 'admin') return;
  state.adminCoupons = await api('/api/admin/coupons');
  document.getElementById('adminCouponsList').innerHTML = state.adminCoupons.map((c) => `
    <div class="admin-product-item">
      <div><strong>${c.code}</strong> <span class="badge">${c.type === 'percent' ? `${c.value}%` : money(c.value)}</span> <span class="badge">mín: ${money(c.min_total)}</span></div>
    </div>
  `).join('');
}

async function loadAdminUsers() {
  if (state.user?.role !== 'admin') return;
  state.adminUsers = await api('/api/admin/users');
  const box = document.getElementById('adminUsersList');

  if (!state.adminUsers.length) {
    box.innerHTML = '<p>Nenhum cadastro encontrado.</p>';
    return;
  }

  box.innerHTML = state.adminUsers.map((u) => `
    <div class="admin-user-item">
      <div>
        <strong>${escapeHtml(u.name)}</strong> <span class="badge">${escapeHtml(u.role)}</span><br />
        <span class="muted">${escapeHtml(u.email)}</span><br />
        <span class="muted">${escapeHtml(u.phone || '-')} | ${escapeHtml(u.city || '-')} - ${escapeHtml(u.state || '-')}</span><br />
        <span class="muted">CPF: ${escapeHtml(u.cpf || '-')}</span><br />
        <span class="muted">Cadastro: ${new Date(u.created_at).toLocaleString('pt-BR')}</span>
      </div>
      <div class="admin-user-metrics">
        <span class="badge">Pedidos: ${u.total_orders}</span>
        <span class="badge">Total: ${money(u.total_spent)}</span>
      </div>
    </div>
  `).join('');
}

async function updateOrderStatus(id, status) {
  await api(`/api/admin/orders/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
  await loadAdminOrders();
}

async function loadAdminOrders() {
  if (state.user?.role !== 'admin') return;
  state.adminOrders = await api('/api/admin/orders');
  const statuses = ['Aguardando fechamento no WhatsApp', 'Em separacao', 'Enviado', 'Venda finalizada', 'Cancelado'];
  const html = state.adminOrders.map((o) => {
    const items = o.items.map((i) => `${escapeHtml(i.product_name)} x${i.quantity}`).join(', ');
    return `
      <div class="card" style="margin-bottom:10px;">
        <p><strong>#${o.id}</strong> ${escapeHtml(o.customer_name)} - ${money(o.total)}</p>
        <p class="muted">${escapeHtml(o.customer_phone || '-')} | ${escapeHtml(o.customer_email || '-')}</p>
        <p>${escapeHtml(items)}</p>
        <p class="muted"><strong>Comprovante:</strong> ${escapeHtml(o.payment_proof || 'Nao informado')}</p>
        <p class="muted"><strong>Endereco:</strong> ${escapeHtml(o.shipping_street || '')}, ${escapeHtml(o.shipping_number || '')}${o.shipping_complement ? `, ${escapeHtml(o.shipping_complement)}` : ''} - ${escapeHtml(o.shipping_neighborhood || '')}, ${escapeHtml(o.shipping_city || '')}/${escapeHtml(o.shipping_state || '')} ${o.shipping_zip ? `- CEP ${escapeHtml(o.shipping_zip)}` : ''}</p>
        <div class="inline-form">
          <select class="order-status" data-id="${o.id}">
            ${statuses.map((s) => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
          <button class="btn light save-order-status" data-id="${o.id}">Atualizar</button>
        </div>
      </div>
    `;
  }).join('');

  const box = document.getElementById('adminOrdersList');
  box.innerHTML = html || '<p>Nenhum pedido.</p>';
  box.querySelectorAll('.save-order-status').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const status = box.querySelector(`.order-status[data-id="${id}"]`).value;
      await updateOrderStatus(id, status);
    });
  });
}

async function loadAdminStockReport() {
  if (state.user?.role !== 'admin') return;
  const productId = document.getElementById('stockFilterProduct')?.value || '';
  const dateFrom = document.getElementById('stockFilterDateFrom')?.value || '';
  const dateTo = document.getElementById('stockFilterDateTo')?.value || '';
  const query = new URLSearchParams();
  if (productId) query.set('productId', productId);
  if (dateFrom) query.set('dateFrom', dateFrom);
  if (dateTo) query.set('dateTo', dateTo);

  const data = await api(`/api/admin/stock-report${query.toString() ? `?${query.toString()}` : ''}`);
  state.adminStockReport = data.products || [];
  state.adminStockMovements = data.movements || [];

  const reportBox = document.getElementById('adminStockReport');
  const movementsBox = document.getElementById('adminStockMovements');
  const productSelect = document.getElementById('stockFilterProduct');

  if (productSelect) {
    const currentValue = productSelect.value;
    const sourceProducts = state.adminProducts.length ? state.adminProducts : state.adminStockReport;
    productSelect.innerHTML = '<option value="">Todos</option>';
    sourceProducts
      .slice()
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'))
      .forEach((p) => {
        const opt = document.createElement('option');
        opt.value = String(p.id);
        opt.textContent = p.name;
        productSelect.appendChild(opt);
      });
    productSelect.value = currentValue;
  }

  if (!state.adminStockReport.length) {
    reportBox.innerHTML = '<p>Nenhum produto para controle de estoque.</p>';
  } else {
    reportBox.innerHTML = state.adminStockReport.map((p) => `
      <div class="admin-product-item">
        <div>
          <strong>${escapeHtml(p.name)}</strong>
          <span class="badge">Estoque: ${p.stock}</span>
          <span class="badge">Vendidos: ${p.sold_units}</span>
          ${p.low_stock ? '<span class="badge" style="background:#ffe4e1;color:#b42318;">Estoque baixo</span>' : ''}
        </div>
      </div>
    `).join('');
  }

  if (!state.adminStockMovements.length) {
    movementsBox.innerHTML = '<p>Sem movimentações de estoque.</p>';
  } else {
    movementsBox.innerHTML = `
      <h4 class="section-title" style="font-size:1rem;margin-top:12px;">Últimas movimentações</h4>
      ${state.adminStockMovements.map((m) => `
        <div class="admin-product-item">
          <div>
            <strong>${escapeHtml(m.product_name)}</strong>
            <span class="badge">${m.delta > 0 ? `+${m.delta}` : m.delta}</span>
            <span class="badge">${escapeHtml(m.reason)}</span>
            ${m.reference_order_id ? `<span class="badge">Pedido #${m.reference_order_id}</span>` : ''}
            <div class="muted">${new Date(m.created_at).toLocaleString('pt-BR')}</div>
          </div>
        </div>
      `).join('')}
    `;
  }
}

function bindEvents() {
  document.getElementById('btnProducts').addEventListener('click', () => showSection('products'));
  document.getElementById('btnFavorites').addEventListener('click', async () => { showSection('favorites'); await loadFavorites(); });
  document.getElementById('btnAuth').addEventListener('click', () => showSection('auth'));
  document.getElementById('btnOrders').addEventListener('click', async () => { showSection('orders'); await loadMyOrders(); });
  document.getElementById('btnAdmin').addEventListener('click', async () => {
    showSection('admin');
    await loadAdminCategories();
    await loadAdminProducts();
    await loadAdminCoupons();
    await loadAdminUsers();
    await loadAdminOrders();
    await loadAdminStockReport();
  });

  document.getElementById('btnLogout').addEventListener('click', () => { clearSession(); showSection('auth'); });

  document.getElementById('registerBtn').addEventListener('click', handleRegister);
  document.getElementById('loginBtn').addEventListener('click', handleLogin);
  document.getElementById('forgotBtn').addEventListener('click', handleForgotPassword);
  document.getElementById('resetBtn').addEventListener('click', handleResetPassword);

  document.getElementById('btnApplyFilters').addEventListener('click', loadProducts);
  document.getElementById('btnQuickSearch').addEventListener('click', loadProducts);
  document.getElementById('searchProduct').addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') await loadProducts();
  });
  document.getElementById('calcShippingBtn').addEventListener('click', handleCalcShipping);
  document.getElementById('applyCouponBtn').addEventListener('click', handleApplyCoupon);
  document.getElementById('checkoutBtn').addEventListener('click', handleCheckout);
  document.getElementById('checkoutWhatsBtn').addEventListener('click', handleResendLastOrderWhatsapp);
  document.getElementById('talkSellerBtn').addEventListener('click', () => {
    const items = state.cart.length
      ? state.cart.map((i) => `${i.product.name} x${i.quantity}`).join(', ')
      : 'Sem itens no carrinho ainda';
    const msg = `Olá! Quero falar sobre os produtos: ${items}`;
    const url = normalizeWhatsappUrl(state.settings?.phone, msg);
    window.open(url, '_blank', 'noopener');
  });

  document.getElementById('createProductBtn').addEventListener('click', saveProduct);
  document.getElementById('clearProductFormBtn').addEventListener('click', clearProductForm);
  document.getElementById('saveContactSettingsBtn').addEventListener('click', saveSettings);
  document.getElementById('createCouponBtn').addEventListener('click', createCoupon);
  document.getElementById('btnApplyStockFilters').addEventListener('click', loadAdminStockReport);
  document.getElementById('createCategoryBtn').addEventListener('click', createCategory);
}

function initTicker() {
  const track = document.getElementById('siteTickerTrack');
  if (!track || track.dataset.ready === '1') return;
  track.innerHTML = `${track.innerHTML}${track.innerHTML}`;
  track.dataset.ready = '1';
}

async function bootstrap() {
  initTicker();
  bindEvents();
  setupPaymentOptions();
  refreshUIByRole();
  renderCart();
  await loadSettings();
  await loadCategories();
  await loadProducts();
  await loadFavorites();

  if (state.user) {
    showSection('products');
    await loadMyOrders();
  } else {
    showSection('auth');
  }
}

bootstrap();
