// ====== SUPABASE CONFIG: palitan ng galing sa Project Settings > API ======
const SUPABASE_URL = 'https://xuaptwbnghxhbufzyyin.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_7VircjOeBDbtOthPjTgslw_kjhIbtJE';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const toUser = r => ({ id: r.id, fullName: r.full_name, email: r.email, role: r.role, contactNumber: r.contact_number || '' });
const toItem = r => ({ id: r.id, title: r.title, type: r.type, category: r.category, location: r.location, date: r.date,
    dateReported: r.date_reported, description: r.description, contact: r.contact, image: r.image, status: r.status,
    reportedByUserId: r.reported_by_user_id, reportStatus: r.report_status, reviewedByAdminId: r.reviewed_by_admin_id,
    storageStatus: r.storage_status, archivedAt: r.archived_at });
const toClaim = r => ({ claimId: r.claim_id, itemId: r.item_id, claimantUserId: r.claimant_user_id,
    proofDescription: r.proof_description, status: r.status, reviewedByAdminId: r.reviewed_by_admin_id, claimDate: r.claim_date,
    claimantName: r.claimant_name, studentIdNumber: r.student_id_number, claimantContact: r.claimant_contact, idPhotoPath: r.id_photo_path });

let users = [];
let items = [];
let claims = [];
let currentUser = null;
let selectedItemId = null;
let adminPanelOpen = false;

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('form-date').value = getCurrentLocalDateTime();
    const { data: { session } } = await sb.auth.getSession();
    if (session) await loadProfile(session.user.id);
    updateAccountControls();
    await loadData();
});

async function loadProfile(userId) {
    const { data, error } = await sb.from('profiles').select('*').eq('id', userId).single();
    if (error) { console.error(error); currentUser = null; return; }
    currentUser = toUser(data);
}

async function loadData() {
    const [itemsRes, stubsRes, claimsRes, usersRes] = await Promise.all([
        sb.from('items').select('*').order('date_reported', { ascending: false }),
        sb.rpc('pending_claim_item_ids'),
        currentUser ? sb.from('claims').select('*') : { data: [] },
        currentUser ? sb.from('profiles').select('*') : { data: [] }
    ]);
    const failed = [itemsRes, stubsRes, claimsRes, usersRes].find(r => r.error);
    if (failed) { console.error(failed.error); toast('Could not load data from Supabase: ' + failed.error.message); return; }
    items = itemsRes.data.map(toItem);
    users = usersRes.data.map(toUser);
    const realClaims = claimsRes.data.map(toClaim);
    // non-admins only see their own claims; stubs just mark items that have a pending claim
    const stubs = stubsRes.data
        .filter(id => !realClaims.some(c => c.itemId === id && c.status === 'Pending'))
        .map(id => ({ claimId: 'pending-' + id, itemId: id, claimantUserId: null, status: 'Pending' }));
    claims = [...realClaims, ...stubs];
    renderItems();
    updateStatistics();
    if (adminPanelOpen) renderAdminConsole();
}

async function finishWrite(res) {
    if (res.error) {
        console.error(res.error);
        toast('Database error: ' + res.error.message);
        await loadData();
        return false;
    }
    await loadData();
    return true;
}

function getCurrentLocalDateTime() {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
}

function formatItemDate(value) {
    if (!value || !value.includes('T')) return value || 'Date not provided';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function openAuthModal() {
    showLogin();
    document.getElementById('login-page').classList.remove('hidden');
    document.getElementById('app-shell').classList.add('hidden');
    document.getElementById('login-email').focus();
}

function closeAuthModal() {
    if (currentUser) {
        document.getElementById('login-page').classList.add('hidden');
        document.getElementById('app-shell').classList.remove('hidden');
        document.getElementById('login-password').value = '';
        document.getElementById('register-password').value = '';
    }
}

function showLogin() {
    document.getElementById('auth-title').textContent = 'Welcome back';
    document.getElementById('auth-subtitle').textContent = 'Sign in to your NEU account to continue.';
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('register-form').classList.add('hidden');
    document.getElementById('login-email').focus();
}

function showRegistration() {
    document.getElementById('auth-title').textContent = 'Create your account';
    document.getElementById('auth-subtitle').textContent = 'Register with your official NEU email to get started.';
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('register-form').classList.remove('hidden');
    document.getElementById('register-name').focus();
}

async function handleRegistration(event) {
    event.preventDefault();
    const form = document.getElementById('register-form');
    if (!form.reportValidity()) return;
    const email = document.getElementById('register-email').value.trim().toLowerCase();
    if (!email.endsWith('@neu.edu.ph')) {
        toast('Registration is limited to an @neu.edu.ph email address.');
        document.getElementById('register-email').focus();
        return;
    }
    const { data, error } = await sb.auth.signUp({
        email,
        password: document.getElementById('register-password').value,
        options: { data: {
            full_name: document.getElementById('register-name').value.trim(),
            role: document.getElementById('register-role').value,
            contact_number: document.getElementById('register-contact').value.trim()
        } }
    });
    if (error) { toast('Registration failed: ' + error.message); return; }
    if (!data.session) {
        toast('Account created. Please confirm your email, then sign in.');
        showLogin();
        document.getElementById('login-email').value = email;
        return;
    }
    await signInUser(data.user);
}

async function handleLogin(event) {
    event.preventDefault();
    const form = document.getElementById('login-form');
    if (!form.reportValidity()) return;
    const { data, error } = await sb.auth.signInWithPassword({
        email: document.getElementById('login-email').value.trim().toLowerCase(),
        password: document.getElementById('login-password').value
    });
    if (error) { toast('Sign in failed: ' + error.message); return; }
    await signInUser(data.user);
}

async function signInUser(authUser) {
    await loadProfile(authUser.id);
    closeAuthModal();
    updateAccountControls();
    await loadData();
}

async function signOut() {
    await sb.auth.signOut();
    currentUser = null;
    users = [];
    adminPanelOpen = false;
    document.getElementById('admin-panel').classList.add('hidden');
    document.getElementById('admin-reports').replaceChildren();
    document.getElementById('admin-claims').replaceChildren();
    document.getElementById('admin-inventory').replaceChildren();
    updateAccountControls();
    await loadData();
}

function updateAccountControls() {
    const signedIn = Boolean(currentUser);
    document.getElementById('auth-toggle').classList.toggle('hidden', signedIn);
    document.getElementById('signout-button').classList.toggle('hidden', !signedIn);
    document.getElementById('admin-toggle').classList.toggle('hidden', currentUser?.role !== 'admin');

    const label = document.getElementById('account-label');
    label.textContent = signedIn ? `${currentUser.fullName} · ${currentUser.role}` : '';
    label.classList.toggle('hidden', !signedIn);
}

function requireSignedInUser() {
    if (currentUser) return true;
    toast('Please sign in first.');
    openAuthModal();
    return false;
}

function requireAdmin() {
    return Boolean(currentUser && currentUser.role === 'admin');
}

function renderItems() {
    const grid = document.getElementById('items-grid');
    const noResults = document.getElementById('no-results');
    const searchVal = document.getElementById('search-input').value.trim().toLowerCase();
    const statusVal = document.getElementById('filter-status').value;
    const categoryVal = document.getElementById('filter-category').value;
    grid.replaceChildren();

    const publishedItems = items.filter(item =>
        item.reportStatus === 'Approved' && !['Archived', 'Disposed', 'Cancelled'].includes(item.status)
    );
    const filteredItems = publishedItems.filter(item => {
        const matchesSearch = item.title.toLowerCase().includes(searchVal) ||
            item.description.toLowerCase().includes(searchVal) ||
            item.location.toLowerCase().includes(searchVal);
        const hasPendingClaim = claims.some(claim => claim.itemId === item.id && claim.status === 'Pending');
        const matchesStatus = statusVal === 'All' ||
            (statusVal === 'Under Review' ? hasPendingClaim : item.status === statusVal);
        const matchesCategory = categoryVal === 'All' || item.category === categoryVal;
        return matchesSearch && matchesStatus && matchesCategory;
    });

    noResults.classList.toggle('hidden', filteredItems.length > 0);
    filteredItems.forEach(item => {
        const pendingClaim = claims.some(claim => claim.itemId === item.id && claim.status === 'Pending');
        const statusLabel = pendingClaim ? 'Claim Pending' : item.status;
        const statusClass = item.status === 'Lost' ? 'badge-lost' :
            item.status === 'Found' ? 'badge-found' :
            pendingClaim ? 'badge-review' : 'badge-claimed';
        const card = document.createElement('article');
        card.className = 'item-card';
        card.dataset.itemId = item.id;

        const image = document.createElement('img');
        image.src = item.image || 'https://via.placeholder.com/400x200?text=No+Image';
        image.alt = item.title;
        image.loading = 'lazy';
        image.decoding = 'async';
        image.className = 'card-img';
        card.appendChild(image);

        const body = document.createElement('div');
        body.className = 'card-body';
        const top = document.createElement('div');
        top.className = 'card-top';
        const badge = document.createElement('span');
        badge.className = `badge ${statusClass}`;
        badge.textContent = statusLabel;
        const date = document.createElement('span');
        date.className = 'card-date';
        date.textContent = formatItemDate(item.date);
        top.append(badge, date);

        const title = document.createElement('h3');
        title.className = 'card-title';
        title.textContent = item.title;
        const location = document.createElement('p');
        location.className = 'card-location';
        location.textContent = `Location: ${item.location}`;
        const description = document.createElement('p');
        description.className = 'card-desc';
        description.textContent = item.description;
        const button = document.createElement('button');
        button.className = 'btn btn-card';
        button.textContent = 'View Details & Claim';
        button.addEventListener('click', () => openDetailModal(item.id));
        body.append(top, title, location, description, button);
        card.appendChild(body);
        grid.appendChild(card);
    });
}

function updateStatistics() {
    const publishedItems = items.filter(item => item.reportStatus === 'Approved');
    document.getElementById('stat-total').innerText = items.filter(item => item.reportStatus !== 'Rejected').length;
    document.getElementById('stat-lost').innerText = publishedItems.filter(item => item.status === 'Lost').length;
    document.getElementById('stat-found').innerText = publishedItems.filter(item => item.status === 'Found').length;
    document.getElementById('stat-claimed').innerText = publishedItems.filter(item => item.status === 'Claimed').length;
}

function openReportModal() {
    if (!requireAdmin()) { toast('Only admins can report items.'); return; }
    document.getElementById('form-contact').value = currentUser.contactNumber || currentUser.fullName;
    document.getElementById('form-date').value = getCurrentLocalDateTime();
    document.getElementById('report-modal').classList.remove('hidden');
}

function closeReportModal() {
    document.getElementById('report-modal').classList.add('hidden');
    document.getElementById('report-form').reset();
}

function openDetailModal(id) {
    selectedItemId = id;
    const item = items.find(entry => entry.id === id && entry.reportStatus === 'Approved');
    if (!item) return;

    document.getElementById('detail-title').innerText = item.title;
    document.getElementById('detail-location').innerText = item.location;
    document.getElementById('detail-date').innerText = formatItemDate(item.date);
    document.getElementById('detail-contact').innerText = item.contact;
    document.getElementById('detail-description').innerText = item.description;
    document.getElementById('detail-category').innerText = item.category;
    document.getElementById('detail-img').src = item.image || 'https://via.placeholder.com/400x200?text=No+Image';
    const statusEl = document.getElementById('detail-status');
    statusEl.innerText = item.status;
    statusEl.className = `badge ${item.status === 'Lost' ? 'badge-lost' : item.status === 'Found' ? 'badge-found' : 'badge-claimed'}`;

    const claimSection = document.getElementById('claim-section');
    const claimMessage = document.getElementById('claim-message');
    const pendingClaim = claims.find(claim => claim.itemId === id && claim.status === 'Pending');
    const myClaim = claims.find(claim => claim.itemId === id && claim.claimantUserId === currentUser?.id && claim.status === 'Pending');
    if (item.status === 'Claimed' || ['Archived', 'Disposed'].includes(item.status)) {
        claimSection.classList.add('hidden');
        claimMessage.classList.add('hidden');
    } else if (pendingClaim) {
        claimSection.classList.add('hidden');
        claimMessage.textContent = myClaim
            ? 'Your claim is waiting for admin review.'
            : 'A claim for this item is already waiting for admin review.';
        claimMessage.classList.remove('hidden');
    } else {
        claimSection.classList.toggle('hidden', !currentUser || currentUser.role === 'admin');
        claimMessage.classList.toggle('hidden', Boolean(currentUser && currentUser.role !== 'admin'));
        if (!currentUser) claimMessage.textContent = 'Sign in with an NEU demo account to submit a claim.';
        else if (currentUser.role === 'admin') claimMessage.textContent = 'Admin accounts review claims in the admin console.';
    }
    document.getElementById('detail-modal').classList.remove('hidden');
}

function closeDetailModal() {
    document.getElementById('detail-modal').classList.add('hidden');
    document.getElementById('claim-form').reset();
}

function toggleAdminPanel() {
    if (!requireAdmin()) {
        toast('Sign in with an admin account to access the admin console.');
        return;
    }
    adminPanelOpen = !adminPanelOpen;
    document.getElementById('admin-panel').classList.toggle('hidden', !adminPanelOpen);
    if (!adminPanelOpen) {
        document.getElementById('admin-reports').replaceChildren();
        document.getElementById('admin-claims').replaceChildren();
        document.getElementById('admin-inventory').replaceChildren();
        return;
    }
    renderAdminConsole();
    document.getElementById('admin-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderAdminConsole() {
    if (!requireAdmin() || !adminPanelOpen) return;
    renderPendingReports();
    renderPendingClaims();
    renderInventory();
}

function createAdminCard(titleText, detailText) {
    const card = document.createElement('article');
    card.className = 'admin-claim-card';
    const title = document.createElement('h4');
    title.textContent = titleText;
    const details = document.createElement('p');
    details.textContent = detailText;
    card.append(title, details);
    return card;
}

function renderPendingReports() {
    const container = document.getElementById('admin-reports');
    container.replaceChildren();
    const pendingReports = items.filter(item => item.reportStatus === 'Pending');
    if (pendingReports.length === 0) {
        container.appendChild(createEmptyMessage('There are no pending item reports.'));
        return;
    }

    pendingReports.forEach(item => {
        const reporter = users.find(user => user.id === item.reportedByUserId);
        const card = createAdminCard(item.title, `${item.type} · ${item.category} · ${item.location} · Reported by ${reporter?.fullName || item.contact} (${reporter?.email || 'unknown email'})`);
        const description = document.createElement('p');
        description.textContent = item.description;
        card.appendChild(description);
        if (item.image) {
            const image = document.createElement('img');
            image.src = item.image;
            image.alt = `Submitted photo of ${item.title}`;
            image.className = 'admin-item-image';
            card.appendChild(image);
        }
        const actions = document.createElement('div');
        actions.className = 'admin-claim-actions';
        actions.append(
            createActionButton('Approve report', 'btn-approve', () => reviewReport(item.id, 'Approved')),
            createActionButton('Reject report', 'btn-reject', () => reviewReport(item.id, 'Rejected'))
        );
        card.appendChild(actions);
        container.appendChild(card);
    });
}

function renderPendingClaims() {
    const container = document.getElementById('admin-claims');
    container.replaceChildren();
    const pendingClaims = claims.filter(claim => claim.status === 'Pending');
    if (pendingClaims.length === 0) {
        container.appendChild(createEmptyMessage('There are no pending claim requests.'));
        return;
    }

    pendingClaims.forEach(claim => {
        const item = items.find(entry => entry.id === claim.itemId);
        const claimant = users.find(user => user.id === claim.claimantUserId);
        if (!item) return;
        const card = createAdminCard(item.title, `Claimant: ${claimant?.fullName || 'Unknown'} · ${claimant?.email || 'unknown email'} · ${claimant?.contactNumber || 'No contact number'}`);
        const date = document.createElement('p');
        date.textContent = `Claim submitted ${new Date(claim.claimDate).toLocaleString()}`;
        const proofLabel = document.createElement('strong');
        proofLabel.className = 'admin-claim-label';
        proofLabel.textContent = 'Proof of ownership';
        const proof = document.createElement('p');
        proof.className = 'admin-proof';
        proof.textContent = claim.proofDescription;
        const actions = document.createElement('div');
        actions.className = 'admin-claim-actions';
        actions.append(
            createActionButton('Approve claim', 'btn-approve', () => reviewClaim(claim.claimId, 'Approved')),
            createActionButton('Reject claim', 'btn-reject', () => reviewClaim(claim.claimId, 'Rejected'))
        );
        const creds = document.createElement('p');
        creds.textContent = `Name: ${claim.claimantName || '-'} · School ID no.: ${claim.studentIdNumber || '-'} · Contact: ${claim.claimantContact || '-'}`;
        card.append(date, creds);
        if (claim.idPhotoPath) card.appendChild(createActionButton('View school ID photo', 'btn-secondary', () => viewClaimId(claim.idPhotoPath)));
        card.append(proofLabel, proof, actions);
        container.appendChild(card);
    });
}

function renderInventory() {
    const container = document.getElementById('admin-inventory');
    container.replaceChildren();
    const managedItems = items.filter(item => item.reportStatus === 'Approved' && item.type === 'Found');
    if (managedItems.length === 0) {
        container.appendChild(createEmptyMessage('No found items are in the inventory.'));
        return;
    }

    managedItems.forEach(item => {
        const card = createAdminCard(item.title, `${item.status} · ${item.storageStatus || 'Not in storage'} · Reported ${new Date(item.dateReported).toLocaleDateString()}`);
        const actions = document.createElement('div');
        actions.className = 'admin-claim-actions admin-inventory-actions';
        if (!['Claimed', 'Archived', 'Disposed'].includes(item.status)) {
            actions.appendChild(createActionButton(
                item.storageStatus === 'In Storage' ? 'Mark Active Found' : 'Mark In Storage',
                'btn-secondary',
                () => updateStorageStatus(item.id, item.storageStatus === 'In Storage' ? 'Active Found' : 'In Storage')
            ));
        }
        if (item.status === 'Archived') {
            actions.appendChild(createActionButton('Mark Disposed', 'btn-reject', () => setItemStatus(item.id, 'Disposed')));
        } else if (item.status === 'Found' && hasReachedRetention(item)) {
            actions.appendChild(createActionButton('Archive item', 'btn-reject', () => setItemStatus(item.id, 'Archived')));
        } else if (item.status === 'Found') {
            const retentionNote = document.createElement('p');
            retentionNote.className = 'retention-note';
            retentionNote.textContent = `Retention period (${document.getElementById('retention-days').value} days) has not elapsed.`;
            card.appendChild(retentionNote);
        }
        card.appendChild(actions);
        container.appendChild(card);
    });
}

function createActionButton(label, className, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn ${className}`;
    button.textContent = label;
    button.addEventListener('click', action);
    return button;
}

function createEmptyMessage(message) {
    const empty = document.createElement('p');
    empty.className = 'admin-empty';
    empty.textContent = message;
    return empty;
}

async function reviewReport(itemId, decision) {
    if (!requireAdmin() || !['Approved', 'Rejected'].includes(decision)) return;
    await finishWrite(await sb.from('items')
        .update({ report_status: decision, reviewed_by_admin_id: currentUser.id, reviewed_at: new Date().toISOString() })
        .eq('id', itemId).eq('report_status', 'Pending'));
}

async function reviewClaim(claimId, decision) {
    if (!requireAdmin() || !['Approved', 'Rejected'].includes(decision)) return;
    const claim = claims.find(entry => entry.claimId === claimId && entry.status === 'Pending');
    if (!claim) {
        toast('This pending claim could not be found. Refresh the admin console and try again.');
        renderAdminConsole();
        return;
    }
    const review = { status: decision, reviewed_by_admin_id: currentUser.id, reviewed_at: new Date().toISOString() };
    let res = await sb.from('claims').update(review).eq('claim_id', claimId);
    if (!res.error && decision === 'Approved') {
        res = await sb.from('items').update({ status: 'Claimed' }).eq('id', claim.itemId);
        if (!res.error) {
            res = await sb.from('claims').update({ ...review, status: 'Rejected' })
                .eq('item_id', claim.itemId).eq('status', 'Pending');
        }
    }
    await finishWrite(res);
}

async function updateStorageStatus(itemId, storageStatus) {
    if (!requireAdmin()) return;
    await finishWrite(await sb.from('items')
        .update({ storage_status: storageStatus, storage_updated_at: new Date().toISOString() })
        .eq('id', itemId));
}

async function setItemStatus(itemId, status) {
    if (!requireAdmin()) return;
    const item = items.find(entry => entry.id === itemId);
    if (!item) return;
    if (status === 'Archived' && (item.status !== 'Found' || !hasReachedRetention(item))) {
        toast('This item must be an active found item that has reached its retention period before archiving.');
        return;
    }
    if (status === 'Disposed' && item.status !== 'Archived') {
        toast('Only archived items can be marked disposed.');
        return;
    }
    await finishWrite(await sb.from('items')
        .update({ status, ...(status === 'Archived' ? { archived_at: new Date().toISOString() } : {}) })
        .eq('id', itemId));
}

async function archiveEligibleItems() {
    if (!requireAdmin()) return;
    const retentionDays = Number(document.getElementById('retention-days').value);
    const ids = items
        .filter(item => item.reportStatus === 'Approved' && item.type === 'Found' && item.status === 'Found')
        .filter(item => hasReachedRetention(item, retentionDays))
        .map(item => item.id);
    if (ids.length === 0) {
        toast(`No active found items have reached the ${retentionDays}-day retention period.`);
        return;
    }
    const ok = await finishWrite(await sb.from('items')
        .update({ status: 'Archived', archived_at: new Date().toISOString() }).in('id', ids));
    if (ok) toast(`${ids.length} item(s) archived.`);
}

function hasReachedRetention(item, days = Number(document.getElementById('retention-days').value)) {
    const reportedAt = new Date(item.dateReported || item.date).getTime();
    const threshold = Date.now() - days * 24 * 60 * 60 * 1000;
    return Number.isFinite(reportedAt) && reportedAt <= threshold;
}

async function handleReportSubmit(event) {
    event.preventDefault();
    if (!requireAdmin()) { toast('Only admins can report items.'); return; }
    const form = document.getElementById('report-form');
    if (!form.reportValidity()) return;
    const requiredFields = ['form-title', 'form-category', 'form-date', 'form-location', 'form-description', 'form-contact'];
    const emptyField = requiredFields.map(id => document.getElementById(id)).find(field => !field.value.trim());
    if (emptyField) {
        toast('Please complete all required fields.');
        emptyField.focus();
        return;
    }

    const type = document.getElementById('form-type').value;
    const imageFile = document.getElementById('form-image-file').files[0];
    let image = document.getElementById('form-image').value.trim();
    if (imageFile) {
        if (!imageFile.type.startsWith('image/')) { toast('Please select a valid image file.'); return; }
        if (imageFile.size > 10 * 1024 * 1024) { toast('The photo must be 10 MB or smaller.'); return; }
        const ext = (imageFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const path = `${currentUser.id}/${Date.now()}.${ext}`;
        const photo = await compressImage(imageFile, 1200, 0.8);
        const upload = await sb.storage.from('item-images').upload(path, photo, { contentType: photo.type });
        if (upload.error) {
            console.error(upload.error);
            toast('Photo upload failed: ' + upload.error.message);
            return;
        }
        image = sb.storage.from('item-images').getPublicUrl(path).data.publicUrl;
    }

    const isAdmin = currentUser.role === 'admin';
    const res = await sb.from('items').insert({
        title: document.getElementById('form-title').value.trim(),
        type,
        category: document.getElementById('form-category').value,
        location: document.getElementById('form-location').value.trim(),
        date: new Date(document.getElementById('form-date').value).toISOString(),
        description: document.getElementById('form-description').value.trim(),
        contact: document.getElementById('form-contact').value.trim(),
        image: image || 'https://images.unsplash.com/photo-1584438784894-089d6a62b8fa?auto=format&fit=crop&q=80&w=400',
        status: type,
        reported_by_user_id: currentUser.id,
        report_status: isAdmin ? 'Approved' : 'Pending',
        reviewed_by_admin_id: isAdmin ? currentUser.id : null,
        storage_status: type === 'Found' && isAdmin ? 'In Storage' : 'Not in storage'
    });
    if (!(await finishWrite(res))) return;
    closeReportModal();
    toast(isAdmin ? 'Item entered into the system.' : 'Report submitted! An admin will verify it first. Track it in My Activity.');
}

async function handleClaimSubmit(event) {
    event.preventDefault();
    if (!requireSignedInUser() || currentUser.role === 'admin') return;
    const form = document.getElementById('claim-form');
    if (!form.reportValidity()) return;
    const val = id => document.getElementById(id).value.trim();
    if (!val('claim-name') || !val('claim-student-id') || !val('claim-contact') || !val('claim-proof')) {
        toast('Please complete all required fields.');
        return;
    }
    const idFile = document.getElementById('claim-id-photo').files[0];
    if (!idFile || !idFile.type.startsWith('image/')) { toast('Please attach a photo of your school ID (image file).'); return; }
    if (idFile.size > 10 * 1024 * 1024) { toast('The ID photo must be 10 MB or smaller.'); return; }
    const item = items.find(entry => entry.id === selectedItemId && entry.reportStatus === 'Approved');
    if (!item || (item.status !== 'Lost' && item.status !== 'Found')) {
        toast('This item is not currently available for a claim.');
        return;
    }
    if (item.reportedByUserId === currentUser.id) {
        toast('You cannot submit a claim on an item you reported yourself.');
        return;
    }
    const ext = (idFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${currentUser.id}/${Date.now()}.${ext}`;
    const idPhoto = await compressImage(idFile, 1600, 0.85);
    const upload = await sb.storage.from('claim-ids').upload(path, idPhoto, { contentType: idPhoto.type });
    if (upload.error) { console.error(upload.error); toast('ID photo upload failed: ' + upload.error.message); return; }
    const res = await sb.from('claims').insert({
        item_id: item.id,
        claimant_user_id: currentUser.id,
        proof_description: val('claim-proof'),
        claimant_name: val('claim-name'),
        student_id_number: val('claim-student-id'),
        claimant_contact: val('claim-contact'),
        id_photo_path: path
    });
    if (res.error) await sb.storage.from('claim-ids').remove([path]);
    if (res.error && res.error.code === '23505') {
        toast('A claim for this item is already waiting for admin review.');
        await loadData();
        return;
    }
    if (!(await finishWrite(res))) return;
    closeDetailModal();
    toast('Claim submitted! Track it in My Activity.');
}

// ====== FRIENDLY UX LAYER ======
function toast(message, type) {
    type = type || (/fail|error|could not|cannot|not currently|must |limited to|already|complete all|provide proof|valid image|MB or smaller|sign in first/i.test(message) ? 'error' : 'success');
    let box = document.getElementById('toast-box');
    if (!box) {
        box = document.createElement('div');
        box.id = 'toast-box';
        box.setAttribute('role', 'status');
        box.setAttribute('aria-live', 'polite');
        document.body.appendChild(box);
    }
    if ([...box.children].some(el => el.textContent === message)) return; // no duplicate toasts
    const t = document.createElement('div');
    t.className = 'toast toast-' + type;
    t.textContent = message;
    box.appendChild(t);
    setTimeout(() => t.remove(), 5000);
}

// disable submit buttons while a request is running (prevents double submits)
['handleLogin', 'handleRegistration', 'handleReportSubmit', 'handleClaimSubmit'].forEach(name => {
    const original = window[name];
    window[name] = async function (event) {
        const btn = event.submitter;
        if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Please wait…'; }
        try { await original(event); }
        finally { if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label; } }
    };
});

const _updateAccountControls = updateAccountControls;
updateAccountControls = function () {
    _updateAccountControls();
    const signedIn = Boolean(currentUser);
    document.getElementById('login-page').classList.toggle('hidden', signedIn);
    document.getElementById('app-shell').classList.toggle('hidden', !signedIn);
    document.getElementById('activity-toggle').classList.toggle('hidden', !currentUser || currentUser.role === 'admin');
    document.getElementById('stats-section').classList.toggle('hidden', currentUser?.role !== 'admin');
    document.getElementById('report-item-button').classList.toggle('hidden', currentUser?.role !== 'admin');
    document.getElementById('report-notice').classList.toggle('hidden', currentUser?.role === 'admin');
};

function updateAdminBadge() {
    const badge = document.getElementById('admin-badge');
    const n = items.filter(i => i.reportStatus === 'Pending').length +
        claims.filter(c => c.status === 'Pending' && c.proofDescription !== undefined).length;
    badge.textContent = n;
    badge.classList.toggle('hidden', currentUser?.role !== 'admin' || n === 0);
}
const _loadData = loadData;
loadData = async function () {
    await _loadData();
    statsResetAt = null;
    if (currentUser?.role === 'admin') {
        const { data } = await sb.from('app_settings').select('value').eq('key', 'stats_reset_at').maybeSingle();
        statsResetAt = data?.value || null;
    }
    updateStatistics();
    updateAdminBadge();
};

// clearer messages in the item detail window
const _openDetailModal = openDetailModal;
openDetailModal = function (id) {
    _openDetailModal(id);
    const item = items.find(e => e.id === id);
    if (currentUser) {
        document.getElementById('claim-name').value = currentUser.fullName;
        document.getElementById('claim-contact').value = currentUser.contactNumber || '';
    }
    if (!item) return;
    const section = document.getElementById('claim-section');
    const msg = document.getElementById('claim-message');
    const open = !['Claimed', 'Archived', 'Disposed'].includes(item.status);
    const pending = claims.some(c => c.itemId === id && c.status === 'Pending');
    if (!currentUser && open && !pending) {
        msg.textContent = 'Is this yours? Sign in with your @neu.edu.ph account to claim it. ';
        msg.appendChild(createActionButton('Sign in', 'btn-submit', () => { closeDetailModal(); openAuthModal(); }));
        msg.classList.remove('hidden');
    } else if (currentUser && item.reportedByUserId === currentUser.id && !section.classList.contains('hidden')) {
        section.classList.add('hidden');
        msg.textContent = "You reported this item, so you can't claim it. Track it in My Activity.";
        msg.classList.remove('hidden');
    }
};

// My Activity: students see the status of their own reports and claims
async function openActivityModal() {
    if (!requireSignedInUser()) return;
    document.getElementById('activity-modal').classList.remove('hidden');
    await loadData();
    renderActivity();
}
function closeActivityModal() { document.getElementById('activity-modal').classList.add('hidden'); }

function renderActivity() {
    const body = document.getElementById('activity-body');
    body.replaceChildren();
    const section = (title, rows, emptyText) => {
        const h = document.createElement('h4');
        h.textContent = title;
        body.appendChild(h);
        if (!rows.length) { body.appendChild(createEmptyMessage(emptyText)); return; }
        rows.forEach(r => {
            const row = document.createElement('div');
            row.className = 'activity-row';
            const text = document.createElement('div');
            const t = document.createElement('strong');
            t.textContent = r.title;
            const note = document.createElement('p');
            note.className = 'retention-note';
            note.textContent = r.note;
            text.append(t, note);
            const badge = document.createElement('span');
            badge.className = 'badge ' + ({ Pending: 'badge-review', Approved: 'badge-found', Rejected: 'badge-lost' }[r.status] || 'badge-claimed');
            badge.textContent = r.label;
            row.append(text, badge);
            body.appendChild(row);
        });
    };
    const myClaims = claims.filter(c => c.claimantUserId === currentUser.id);
    section('My Claims', myClaims.map(c => ({
        title: items.find(i => i.id === c.itemId)?.title || 'Item', status: c.status,
        label: c.status === 'Pending' ? 'Waiting for review' : c.status,
        note: c.status === 'Approved' ? 'Approved! Please go to the Campus Security desk with a valid ID.' :
            c.status === 'Rejected' ? 'Not approved. You may submit a new claim with more proof.' : 'An admin is reviewing your proof of ownership.'
    })), "You haven't claimed anything yet.");
}

// ====== ADMIN-ONLY STATS, STATS RESET, CANCEL REPORTS ======
let statsResetAt = null;

updateStatistics = function () {
    const since = statsResetAt ? new Date(statsResetAt).getTime() : 0;
    const counted = items.filter(i => new Date(i.dateReported).getTime() >= since);
    const published = counted.filter(i => i.reportStatus === 'Approved');
    document.getElementById('stat-total').innerText = counted.filter(i => i.reportStatus !== 'Rejected' && i.status !== 'Cancelled').length;
    document.getElementById('stat-lost').innerText = published.filter(i => i.status === 'Lost').length;
    document.getElementById('stat-found').innerText = published.filter(i => i.status === 'Found').length;
    document.getElementById('stat-claimed').innerText = published.filter(i => i.status === 'Claimed').length;
    document.getElementById('stats-since').textContent = statsResetAt
        ? 'Counting reports since ' + new Date(statsResetAt).toLocaleString() : 'Counting all reports (all-time)';
};

async function setStatsReset(value) {
    if (!requireAdmin()) return;
    if (value && !confirm('Reset the statistics to zero? No reports are deleted. Counting just starts from now.')) return;
    const res = await sb.from('app_settings').upsert({ key: 'stats_reset_at', value: value || '' });
    if (res.error) { toast('Could not save: ' + res.error.message); return; }
    statsResetAt = value || null;
    updateStatistics();
    toast(value ? 'Statistics reset.' : 'Showing all-time statistics.');
}
const resetStats = () => setStatsReset(new Date().toISOString());
const showAllTimeStats = () => setStatsReset('');

async function cancelReport(itemId) {
    if (!requireAdmin()) return;
    if (!confirm('Cancel this report? It will be removed from the public list and any pending claim will be rejected.')) return;
    let res = await sb.from('items').update({ status: 'Cancelled' }).eq('id', itemId);
    if (!res.error) {
        res = await sb.from('claims')
            .update({ status: 'Rejected', reviewed_by_admin_id: currentUser.id, reviewed_at: new Date().toISOString() })
            .eq('item_id', itemId).eq('status', 'Pending');
    }
    if (await finishWrite(res)) toast('Report cancelled.');
}


// Admin actions directly on the item cards (replaces the separate "Manage Active Reports" list)
const _renderItems = renderItems;
renderItems = function () {
    _renderItems();
    if (currentUser?.role !== 'admin') return;
    document.querySelectorAll('#items-grid .item-card').forEach(card => {
        const item = items.find(i => String(i.id) === card.dataset.itemId);
        if (!item) return;
        const body = card.querySelector('.card-body');
        if (['Lost', 'Found'].includes(item.status)) {
            body.appendChild(createActionButton('Cancel report', 'btn-reject btn-card-admin', () => cancelReport(item.id)));
        }
        body.appendChild(createActionButton('Delete permanently', 'btn-secondary btn-card-admin', () => deleteItem(item.id)));
    });
};

// Admin opens the claimant's school ID photo (private bucket, short-lived link)
async function viewClaimId(path) {
    if (!requireAdmin()) return;
    const win = window.open('', '_blank');
    const { data, error } = await sb.storage.from('claim-ids').createSignedUrl(path, 120);
    if (error) { if (win) win.close(); toast('Could not open the ID photo: ' + error.message); return; }
    if (win) win.location = data.signedUrl; else toast('Please allow pop-ups to view the ID photo.');
}

// Shrink big phone photos before upload (a 5-10 MB photo makes every page load slow)
async function compressImage(file, maxSize, quality) {
    try {
        const bmp = await createImageBitmap(file);
        const scale = Math.min(1, maxSize / Math.max(bmp.width, bmp.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bmp.width * scale);
        canvas.height = Math.round(bmp.height * scale);
        canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        return blob && blob.size < file.size ? blob : file;
    } catch (error) {
        console.warn('Image compression skipped:', error);
        return file;
    }
}

async function deleteItem(itemId) {
    if (!requireAdmin()) return;
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    if (!confirm(`Permanently delete "${item.title}"? Its claims and photos will be deleted too. This cannot be undone.`)) return;
    const idPaths = claims.filter(c => c.itemId === itemId && c.idPhotoPath).map(c => c.idPhotoPath);
    const res = await sb.from('items').delete().eq('id', itemId);
    if (!res.error) {
        const marker = '/item-images/';
        const at = (item.image || '').indexOf(marker);
        if (at >= 0) await sb.storage.from('item-images').remove([decodeURIComponent(item.image.slice(at + marker.length))]);
        if (idPaths.length) await sb.storage.from('claim-ids').remove(idPaths);
    }
    if (await finishWrite(res)) toast('Item deleted.');
}