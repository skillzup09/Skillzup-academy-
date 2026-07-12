/* =========================================================
   USER PANEL - script.js
   Backend: Firebase (Auth + Realtime Database) - unchanged
   Fixes: safer event handling, numeric localStorage compare,
          disabled-state on buttons to stop double submits,
          notification read-state now uses data-id (no broken
          selectors), coupon + free-course logic added,
          secure in-app PDF viewer, screen-capture deterrents.
   ========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyBkueMv1fO79FeHnrDTAnMMVVbaO1cGWiQ",
  authDomain: "ravion-35bcc.firebaseapp.com",
  databaseURL: "https://ravion-35bcc-default-rtdb.firebaseio.com",
  projectId: "ravion-35bcc",
  storageBucket: "ravion-35bcc.firebasestorage.app",
  messagingSenderId: "640359348397",
  appId: "1:640359348397:web:8e50ee338d2b9a135a2e24"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();

let user = null, myCourses = {}, allCourses = [], curPay = {}, appSets = {};
let promoInterval = null;
let unreadNotifications = new Set();
let isReg = false;
let cf = 'ALL';
let appliedCoupon = null; // {code, percent} or null

/* ---------------- APP BRANDING ---------------- */
db.ref('appSettings').on('value', s => {
    appSets = s.val() || {};
    const name = appSets.appName || 'Learning App';
    document.getElementById('auth-title').innerText = name;

    if (appSets.appLogo) {
        const img = document.getElementById('auth-logo');
        img.src = appSets.appLogo; img.style.display = 'block';
        const himg = document.getElementById('header-logo');
        himg.src = appSets.appLogo; himg.style.display = 'block';
    }
    document.getElementById('app-title-head').innerText = name;
    document.getElementById('policy-content').innerText = appSets.policyText || "No policy defined yet.";
});

/* ---------------- AUTH ---------------- */
function toggleMode() {
    isReg = !isReg;
    document.getElementById('a-name').style.display = isReg ? 'block' : 'none';
    document.getElementById('btn-auth').innerText = isReg ? 'Create Account' : 'Sign In';
    document.getElementById('txt-mode').innerText = isReg ? 'Already have account? Sign In' : 'Create new account';
}

auth.onAuthStateChanged(u => {
    if (u) {
        user = u;
        document.getElementById('auth-screen').style.display = 'none';
        document.getElementById('main-app').style.display = 'block';
        document.getElementById('bottom-nav').style.display = 'flex';
        document.getElementById('prof-email').innerText = u.email || '';

        db.ref('users/' + u.uid).once('value', s => {
            if (s.exists() && s.val().name) {
                const n = s.val().name;
                document.getElementById('u-name').innerText = n.split(' ')[0];
                document.getElementById('prof-name').innerText = n;
            } else {
                document.getElementById('prof-name').innerText = u.displayName || "Student";
            }
        });

        loadData();
        loadNotifications();
    } else {
        user = null;
        document.getElementById('auth-screen').style.display = 'flex';
        document.getElementById('main-app').style.display = 'none';
        document.getElementById('bottom-nav').style.display = 'none';
        if (promoInterval) clearInterval(promoInterval);
    }
});

function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

function submitAuth() {
    const e = document.getElementById('a-email').value.trim();
    const p = document.getElementById('a-pass').value;
    const btn = document.getElementById('btn-auth');
    if (!e || !p) return toast('Please fill all fields');
    if (!isValidEmail(e)) return toast('Enter a valid email address');
    if (p.length < 6) return toast('Password must be at least 6 characters');

    if (isReg) {
        const n = document.getElementById('a-name').value.trim();
        if (!n) return toast('Please enter your name');
        btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span> Creating...';
        auth.createUserWithEmailAndPassword(e, p).then(c => {
            return db.ref('users/' + c.user.uid).update({ name: n, email: e, createdAt: Date.now() });
        }).then(() => {
            toast('Account created successfully');
        }).catch(err => {
            toast(err.message);
        }).finally(() => {
            btn.disabled = false; btn.innerText = isReg ? 'Create Account' : 'Sign In';
        });
    } else {
        btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span> Signing in...';
        auth.signInWithEmailAndPassword(e, p).then(() => {
            toast('Welcome back!');
        }).catch(err => {
            toast(err.message);
        }).finally(() => {
            btn.disabled = false; btn.innerText = isReg ? 'Create Account' : 'Sign In';
        });
    }
}

function loginWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).then(cred => {
        const u = cred.user;
        // merge-friendly update; keeps existing purchased courses etc.
        return db.ref('users/' + u.uid).update({
            name: u.displayName || 'Student',
            email: u.email,
            lastLogin: Date.now()
        }).then(() => toast('Welcome, ' + (u.displayName || 'Student') + '!'));
    }).catch(err => {
        if (err.code !== 'auth/popup-closed-by-user') toast(err.message);
    });
}

function logout() { auth.signOut(); }

/* ---------------- DATA LOADING ---------------- */
function loadData() {
    db.ref('courses').on('value', s => {
        allCourses = [];
        s.forEach(c => allCourses.push({ id: c.key, ...c.val() }));
        renderC();
    });

    db.ref('users/' + user.uid + '/courses').on('value', s => {
        const nC = s.numChildren();
        const oC = Number(localStorage.getItem('cc') || 0);
        myCourses = s.val() || {};
        if (nC > oC && oC !== 0) showConfetti();
        localStorage.setItem('cc', nC);
        renderC();
    });

    db.ref('categories').on('value', s => {
        const d = document.getElementById('cat-chips');
        d.innerHTML = '<div class="chip active" data-cat="ALL" onclick="filt(this,\'ALL\')">All Topics</div>';
        s.forEach(c => {
            const name = c.val().name;
            d.innerHTML += `<div class="chip" data-cat="${name}" onclick="filt(this,'${name.replace(/'/g, "\\'")}')">${name}</div>`;
        });
    });

    db.ref('promotions').on('value', s => {
        const d = document.getElementById('home-promo');
        d.innerHTML = '';
        s.forEach(p => {
            const v = p.val();
            d.innerHTML += `<div class="promo-card" style="background-image:url('${v.img}')" ${v.link ? `onclick="window.open('${v.link}','_blank')"` : ''}></div>`;
        });
        if (d.children.length > 0) {
            if (promoInterval) clearInterval(promoInterval);
            startSlide();
        }
    });

    db.ref('liveSession').on('value', s => {
        const v = s.val();
        const liveCon = document.getElementById('live-con');
        if (v && v.status === 'ON') {
            liveCon.innerHTML = `
                <div class="card" style="border:2px solid #FF6B6B; animation: pulse 2s infinite;">
                    <div class="card-body" style="text-align:center;">
                        <div style="color:#FF6B6B; font-weight:700; margin-bottom:5px; display:flex; align-items:center; justify-content:center; gap:5px;">
                            <i class="fas fa-circle" style="font-size:0.7rem; animation: blink 1s infinite;"></i> LIVE NOW
                        </div>
                        <h2 style="font-size:1.3rem; margin:10px 0;">${v.description || ''}</h2>
                        <p style="color:#888; margin-bottom:10px;">${v.price && Number(v.price) > 0 ? '$' + v.price : 'FREE'}</p>
                        <button class="btn" style="background:#FF6B6B; margin-top:10px;" onclick="window.open('${v.link}','_blank')">Join Stream</button>
                    </div>
                </div>`;
        } else {
            liveCon.innerHTML = '<div class="card"><div class="card-body" style="text-align:center;color:#aaa;"><i class="fas fa-video-slash" style="font-size:2rem;margin-bottom:10px;"></i><p>No active live session</p></div></div>';
        }
    });
}

/* ---------------- NOTIFICATIONS ---------------- */
function loadNotifications() {
    db.ref('notifications').limitToLast(20).on('value', s => {
        const d = document.getElementById('list-notif');
        const a = [];
        const now = Date.now();
        const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);

        s.forEach(x => {
            const n = { id: x.key, ...x.val() };
            if (n.timestamp > twentyFourHoursAgo || n.important) a.unshift(n);
        });

        if (a.length === 0) {
            d.innerHTML = `
                <div class="no-notifications">
                    <i class="fas fa-bell-slash"></i>
                    <p>No notifications yet</p>
                    <p style="font-size: 0.8rem; margin-top: 10px;">You're all caught up!</p>
                </div>`;
            document.getElementById('n-badge').style.display = 'none';
            return;
        }

        d.innerHTML = '';
        let unreadCount = 0;
        unreadNotifications.clear();
        const readNotifications = JSON.parse(localStorage.getItem('readNotifications') || '{}');

        a.forEach(n => {
            if (n.targetType === 'ALL' || (n.targetType === 'SINGLE' && n.targetEmail === user.email)) {
                const isRead = readNotifications[n.id] || false;
                const isNew = !isRead && (now - n.timestamp < 24 * 60 * 60 * 1000);

                if (isNew) { unreadCount++; unreadNotifications.add(n.id); }

                const timeAgo = getTimeAgo(n.timestamp);

                d.innerHTML += `
                <div class="notif-item ${isNew ? 'new-notif' : ''}" data-id="${n.id}" onclick="markAsRead('${n.id}')">
                    <div class="notif-icon"><i class="fas ${n.icon || 'fa-bell'}"></i></div>
                    <div class="notif-content">
                        <div class="notif-message">${n.message || ''}</div>
                        <div class="notif-time">
                            <i class="far fa-clock"></i> ${timeAgo}
                            ${isNew ? '<span style="color: var(--primary); margin-left: 10px; font-weight: 600;">NEW</span>' : ''}
                        </div>
                        ${n.link ? `<div class="notif-link" onclick="window.open('${n.link}','_blank'); event.stopPropagation();">Tap to View <i class="fas fa-arrow-right" style="font-size:0.7rem;"></i></div>` : ''}
                    </div>
                </div>`;
            }
        });

        updateBadge(unreadCount);
    });
}

function updateBadge(count) {
    const badge = document.getElementById('n-badge');
    if (count > 0) {
        badge.style.display = 'flex';
        badge.style.width = count > 9 ? '20px' : '10px';
        badge.style.height = count > 9 ? '20px' : '10px';
        badge.style.alignItems = 'center';
        badge.style.justifyContent = 'center';
        badge.style.fontSize = '8px';
        badge.style.color = 'white';
        badge.innerHTML = count > 9 ? '9+' : '';
    } else {
        badge.style.display = 'none';
    }
}

function getTimeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' minutes ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' hours ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + ' days ago';
    return new Date(timestamp).toLocaleDateString();
}

function markAsRead(notifId) {
    const readNotifications = JSON.parse(localStorage.getItem('readNotifications') || '{}');
    readNotifications[notifId] = true;
    localStorage.setItem('readNotifications', JSON.stringify(readNotifications));
    unreadNotifications.delete(notifId);

    const item = document.querySelector(`.notif-item[data-id="${notifId}"]`);
    if (item) {
        item.classList.remove('new-notif');
        const span = item.querySelector('.notif-time span');
        if (span) span.remove();
    }
    updateBadge(unreadNotifications.size);
}

function openNotif() {
    nav('notif');
    Array.from(unreadNotifications).forEach(id => markAsRead(id));
}

/* ---------------- PROFILE ---------------- */
function openEditProfile() {
    document.getElementById('ed-name').value = document.getElementById('prof-name').innerText;
    document.getElementById('modal-edit').style.display = 'flex';
}
function saveProfile() {
    const n = document.getElementById('ed-name').value.trim();
    if (!n) return toast('Enter a valid name');
    db.ref('users/' + user.uid).update({ name: n }).then(() => {
        toast('Profile Updated');
        document.getElementById('prof-name').innerText = n;
        document.getElementById('u-name').innerText = n.split(' ')[0];
        closeModal('modal-edit');
    });
}

/* ---------------- COURSE LISTING ---------------- */
function filt(el, c) {
    cf = c;
    document.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
    el.classList.add('active');
    renderC();
}

function isUnlocked(c) {
    return !!(myCourses[c.id] || c.isFree === true || c.isFree === 'true');
}

function renderC() {
    const l = document.getElementById('home-courses'), s = document.getElementById('all-courses'),
          m = document.getElementById('my-list'), q = (document.getElementById('search').value || '').toLowerCase();
    l.innerHTML = ''; s.innerHTML = ''; m.innerHTML = '';

    if (allCourses.length === 0) {
        l.innerHTML = '<div style="text-align:center; padding:40px; color:#aaa;"><i class="fas fa-book" style="font-size:2rem;margin-bottom:10px;"></i><p>No courses available</p></div>';
        s.innerHTML = '<div style="text-align:center; padding:40px; color:#aaa;"><i class="fas fa-search" style="font-size:2rem;margin-bottom:10px;"></i><p>No courses found</p></div>';
        return;
    }

    allCourses.forEach(c => {
        const owned = isUnlocked(c);
        const catText = c.categoryName || 'General';
        const imgSrc = (c.bannerUrl && c.bannerUrl.length > 5) ? c.bannerUrl : 'https://via.placeholder.com/300x180/EEE/AAA?text=Course';
        const priceTag = owned
            ? `<span style="font-weight:700; color:#00B894; background:rgba(0,184,148,0.1); padding:4px 10px; border-radius:8px; font-size:0.85rem;">Owned</span>`
            : (c.isFree ? `<span class="free-badge">FREE</span>` : `<span style="font-weight:700; color:#2D3436; background:#F5F6FA; padding:4px 10px; border-radius:8px; font-size:0.85rem;">$${c.price}</span>`);

        const cd = `
        <div class="card" onclick="openC('${c.id}')">
            <img src="${imgSrc}" class="course-img" onerror="this.src='https://via.placeholder.com/300x180/EEE/AAA?text=No+Image'">
            <div class="card-body">
                <span style="font-size:0.75rem; color:var(--primary); font-weight:700; text-transform:uppercase;">${catText}</span>
                <h3 style="font-size:1.1rem; margin:5px 0 10px; color:#2D3436;">${c.title}</h3>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="color:#B2BEC3; font-size:0.85rem;"><i class="fas fa-video"></i> Course</span>
                    ${priceTag}
                </div>
            </div>
        </div>`;
        if ((cf === 'ALL' || catText === cf)) l.innerHTML += cd;
        if (c.title.toLowerCase().includes(q)) s.innerHTML += cd;
        if (owned) m.innerHTML += cd;
    });

    if (m.innerHTML === '') m.innerHTML = `<div style="text-align:center; padding:30px; color:#aaa;"><i class="fas fa-box-open" style="font-size:2rem; margin-bottom:10px;"></i><p>No courses owned yet</p></div>`;
    if (l.innerHTML === '') l.innerHTML = `<div style="text-align:center; padding:30px; color:#aaa;"><i class="fas fa-filter" style="font-size:2rem; margin-bottom:10px;"></i><p>No courses in this category</p></div>`;
}

/* ---------------- COURSE DETAIL ---------------- */
function openC(id) {
    const c = allCourses.find(x => x.id === id);
    if (!c) return;
    const owned = isUnlocked(c);
    const d = document.getElementById('c-det-cont');
    let v = c.videoUrl;
    let videoId = '';

    if (v && v.includes('youtu.be/')) videoId = v.split('youtu.be/')[1].split('?')[0];
    else if (v && v.includes('v=')) videoId = v.split('v=')[1].split('&')[0];
    else if (v && v.includes('youtube.com/embed/')) videoId = v.split('embed/')[1].split('?')[0];

    const imgSrc = (c.bannerUrl && c.bannerUrl.length > 5) ? c.bannerUrl : 'https://via.placeholder.com/300x180/EEE/AAA?text=Course';

    d.innerHTML = `
    ${owned
        ? `<div class="protected">
             <div class="video-container">
                <iframe id="course-video" src="https://www.youtube.com/embed/${videoId}?modestbranding=1&rel=0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                <button class="video-fullscreen-btn" onclick="toggleFullScreen('course-video')"><i class="fas fa-expand"></i> Full Screen</button>
             </div>
             ${c.notesUrl ? `<button class="btn-outline" style="padding:12px; width:100%; border-radius:12px; margin-bottom:5px;" onclick="openSecurePdf('${c.notesUrl}','${(c.title || '').replace(/'/g, "\\'")}')"><i class="fas fa-file-pdf"></i> View Notes (Secure Viewer)</button>`
                          : ''}
             <p class="security-note"><i class="fas fa-shield-alt"></i> This content is protected. Screenshots and downloads are restricted.</p>
           </div>`
        : `<img src="${imgSrc}" style="width:100%; border-radius:15px; filter:brightness(0.9);">
           <h2 style="position:absolute; top:35%; left:50%; transform:translate(-50%,-50%); color:white; text-shadow:0 2px 10px rgba(0,0,0,0.5);"><i class="fas fa-lock"></i> Locked</h2>
           <div style="margin-top:-20px; position:relative; text-align:center;">
                ${c.isFree
                    ? `<button class="btn btn-free" onclick="unlockFree('${c.id}')"><i class="fas fa-gift"></i> Unlock for Free</button>`
                    : `<button class="btn" onclick="pay('${c.id}','${c.price}','${(c.title || '').replace(/'/g, "\\'")}')">Buy Access for $${c.price}</button>`}
           </div>`
    }
    <h2 style="margin-top:20px; color:#2D3436;">${c.title}</h2>
    <p style="color:#636E72; line-height:1.6; margin-top:10px;">${c.description || ''}</p>
    <div style="display:flex; justify-content:space-between; margin-top:15px; color:#888; font-size:0.9rem;">
        <span><i class="fas fa-tag"></i> ${c.categoryName || 'General'}</span>
        <span><i class="fas fa-dollar-sign"></i> ${c.isFree ? 'Free' : c.price}</span>
    </div>
    `;
    document.getElementById('modal-course').style.display = 'flex';
}

function unlockFree(courseId) {
    if (!user) return;
    db.ref('users/' + user.uid + '/courses/' + courseId).set(true).then(() => {
        toast('Course unlocked!');
        closeModal('modal-course');
        showConfetti();
    }).catch(err => toast(err.message));
}

function toggleFullScreen(videoId) {
    const iframe = document.getElementById(videoId);
    if (!iframe) return;
    if (iframe.requestFullscreen) iframe.requestFullscreen();
    else if (iframe.webkitRequestFullscreen) iframe.webkitRequestFullscreen();
    else if (iframe.msRequestFullscreen) iframe.msRequestFullscreen();
}

/* ---------------- SECURE PDF VIEWER ---------------- */
function openSecurePdf(url, title) {
    if (!url) return toast('No document available');
    document.getElementById('pdf-title').innerText = title || 'Document';
    document.getElementById('pdf-watermark-text').innerText = (user && user.email) ? user.email : 'Protected Copy';
    // Route through Google's viewer so the raw file URL never opens directly in a new tab.
    const viewerUrl = 'https://docs.google.com/viewer?embedded=true&url=' + encodeURIComponent(url);
    document.getElementById('pdf-frame').src = viewerUrl;
    document.getElementById('modal-pdf').style.display = 'flex';
}
function closePdfViewer() {
    document.getElementById('pdf-frame').src = 'about:blank';
    closeModal('modal-pdf');
}

/* ---------------- PAYMENT / COUPON ---------------- */
function pay(id, p, t) {
    appliedCoupon = null;
    document.getElementById('coupon-code').value = '';
    document.getElementById('coupon-msg').innerText = '';
    db.ref('adminSettings').once('value', s => {
        curPay = { id, p: Number(p), t };
        const v = s.val() || {};
        document.getElementById('qr-img').src = v.qr || 'https://via.placeholder.com/180x180/EEE/AAA?text=QR+Code';
        document.getElementById('upi-txt').innerText = v.upi || 'No UPI ID set';
        document.getElementById('pay-amount').innerText = '$' + curPay.p;
        document.getElementById('modal-pay').style.display = 'flex';
    });
}

function applyCoupon() {
    const code = document.getElementById('coupon-code').value.trim();
    const msg = document.getElementById('coupon-msg');
    if (!code) { msg.className = 'coupon-msg err'; msg.innerText = 'Enter a coupon code'; return; }

    db.ref('coupons/' + code.toUpperCase()).once('value').then(snap => {
        if (!snap.exists()) {
            appliedCoupon = null;
            msg.className = 'coupon-msg err';
            msg.innerText = 'Invalid or expired coupon';
            document.getElementById('pay-amount').innerText = '$' + curPay.p;
            return;
        }
        const c = snap.val();
        const percent = Number(c.percent || 0);
        const discounted = Math.max(0, curPay.p - (curPay.p * percent / 100));
        appliedCoupon = { code: code.toUpperCase(), percent, discounted };
        msg.className = 'coupon-msg ok';
        msg.innerText = `Coupon applied: ${percent}% off`;
        document.getElementById('pay-amount').innerText = '$' + discounted.toFixed(2);
    }).catch(() => {
        msg.className = 'coupon-msg err';
        msg.innerText = 'Could not verify coupon right now';
    });
}

function showPre() {
    const f = document.getElementById('file-in').files[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('Please upload an image screenshot');
    const r = new FileReader();
    r.onload = e => {
        document.getElementById('prev-img').src = e.target.result;
        document.getElementById('prev-img').style.display = 'block';
    };
    r.readAsDataURL(f);
}

function sendPay() {
    const s = document.getElementById('prev-img').src;
    if (!s || s.includes('placeholder') || !s.startsWith('data:')) return toast('Upload proof first');

    const btn = document.getElementById('btn-send-pay');
    btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span> Submitting...';

    const finalAmount = appliedCoupon ? appliedCoupon.discounted : curPay.p;

    db.ref('payments').push({
        userId: user.uid,
        userEmail: user.email,
        courseId: curPay.id,
        courseTitle: curPay.t,
        amount: finalAmount,
        originalAmount: curPay.p,
        couponCode: appliedCoupon ? appliedCoupon.code : null,
        screenshot: s,
        status: 'PENDING',
        timestamp: Date.now()
    }).then(() => {
        closeModal('modal-pay');
        toast('Payment sent for review');
        document.getElementById('prev-img').style.display = 'none';
        document.getElementById('file-in').value = '';
    }).catch(err => toast('Error: ' + err.message))
      .finally(() => { btn.disabled = false; btn.innerText = 'Submit Verification'; });
}

/* ---------------- PROMO SLIDER ---------------- */
function startSlide() {
    const d = document.getElementById('home-promo');
    if (!d || d.children.length === 0) return;
    if (promoInterval) clearInterval(promoInterval);
    promoInterval = setInterval(() => {
        if (d.scrollLeft + d.clientWidth >= d.scrollWidth - 10) d.scrollLeft = 0;
        else d.scrollLeft += 300;
    }, 3000);
}

/* ---------------- NAVIGATION ---------------- */
function nav(s, el) {
    document.querySelectorAll('.screen').forEach(x => x.style.display = 'none');
    const target = document.getElementById('tab-' + s);
    if (target) target.style.display = 'block';
    document.querySelectorAll('.nav-icon').forEach(x => x.classList.remove('active'));
    const activeEl = el || document.querySelector(`.nav-icon[data-tab="${s}"]`);
    if (activeEl) activeEl.classList.add('active');
    window.scrollTo(0, 0);
}

function closeModal(i) {
    document.getElementById(i).style.display = 'none';
    if (i === 'modal-pay') {
        document.getElementById('prev-img').style.display = 'none';
        document.getElementById('file-in').value = '';
    }
}

function openSupport() {
    if (appSets.supportLink) window.open(appSets.supportLink, '_blank');
    else toast('Support link not available');
}

function toast(m) {
    const t = document.getElementById('toast-box');
    t.innerText = m;
    t.style.opacity = 1;
    t.style.bottom = "120px";
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { t.style.opacity = 0; t.style.bottom = "100px"; }, 3000);
}

function showConfetti() {
    const m = document.getElementById('confetti-modal'), p = document.getElementById('particles'),
          cols = ['#6C63FF', '#8A2BE2', '#FF6B6B', '#FFD166'];
    p.innerHTML = '';
    for (let i = 0; i < 40; i++) {
        const e = document.createElement('div');
        e.className = 'particle';
        e.style.left = Math.random() * 100 + 'vw';
        e.style.animationDuration = (Math.random() * 2 + 1) + 's';
        e.style.backgroundColor = cols[Math.floor(Math.random() * cols.length)];
        p.appendChild(e);
    }
    m.style.display = 'flex';
    setTimeout(() => { m.style.display = 'none'; p.innerHTML = ''; }, 3000);
}

/* ---------------- SECURITY / SCREEN PROTECTION (best-effort) ----------------
   Note for the developer: browsers do not expose a real API to block
   screenshots or screen recording. These measures are honest deterrents
   (disabling right-click/selection/devtools shortcuts, blurring content
   when the tab loses focus) — not guaranteed prevention. */
document.addEventListener('contextmenu', e => {
    if (e.target.closest('.protected') || e.target.closest('#modal-pdf')) e.preventDefault();
});
document.addEventListener('dragstart', e => {
    if (e.target.closest('.protected')) e.preventDefault();
});
document.addEventListener('keydown', e => {
    const blockedInModal = document.getElementById('modal-course').style.display === 'flex' ||
                            document.getElementById('modal-pdf').style.display === 'flex';
    if (!blockedInModal) return;
    // Block common save/print/dev-tools shortcuts while viewing protected content.
    if ((e.ctrlKey || e.metaKey) && ['s', 'p', 'u'].includes(e.key.toLowerCase())) e.preventDefault();
    if (e.key === 'F12') e.preventDefault();
});
document.addEventListener('visibilitychange', () => {
    const guard = document.getElementById('screen-guard');
    const viewingProtected = document.getElementById('modal-pdf').style.display === 'flex';
    if (document.hidden && viewingProtected) {
        guard.style.display = 'flex';
    } else {
        guard.style.display = 'none';
    }
});

/* Cleanup */
window.addEventListener('beforeunload', () => {
    if (promoInterval) clearInterval(promoInterval);
});
