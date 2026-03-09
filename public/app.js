const form = document.getElementById('requestForm');
const submitBtn = document.getElementById('submitBtn');
const successMessage = document.getElementById('successMessage');
const btnText = document.querySelector('.btn-text');
const btnLoader = document.querySelector('.btn-loader');
const phoneInput = document.getElementById('phone');

// URL parametrelerinden kullanıcı adını otomatik al - Birden fazla parametre ismi dene
function getUrlParameter(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

function getUsernameFromUrl() {
    // Yaygın kullanıcı adı parametre isimleri
    const possibleParams = ['username', 'user', 'userName', 'user_name', 'login', 'account', 'userid', 'user_id'];

    for (const param of possibleParams) {
        const value = getUrlParameter(param);
        if (value) {
            return decodeURIComponent(value);
        }
    }
    return null;
}

// postMessage ile parent sayfadan veri al
window.addEventListener('message', (event) => {
    // Güvenlik: Sadece güvendiğiniz domain'lerden mesaj kabul edin
    // Sunucu tarafında veya index.html üzerinden ALLOWED_ORIGIN tanımlıysa onu kullan, yoksa '*' varsay
    const allowedOrigin = window.ALLOWED_ORIGIN || '*';

    if (allowedOrigin !== '*' && event.origin !== allowedOrigin) {
        console.warn('Blocked postMessage from unauthorized origin:', event.origin);
        return;
    }

    const usernameInput = document.getElementById('username');

    if (event.data && event.data.type === 'setUsername' && event.data.username) {
        if (usernameInput) {
            usernameInput.value = event.data.username;
            console.log('Username set via postMessage:', event.data.username);
        }
    }

    // Alternatif: Direkt username gönderme
    if (event.data && typeof event.data === 'string' && usernameInput && !usernameInput.value) {
        usernameInput.value = event.data;
        console.log('Username set via postMessage (direct):', event.data);
    }
});

// Sayfa yüklendiğinde kullanıcı adını doldur ve ayarları getir
window.addEventListener('DOMContentLoaded', () => {
    const usernameInput = document.getElementById('username');

    // Geri Dön butonuna URL'yi API'den çek
    const returnBtn = document.getElementById('returnSiteBtn');
    if (returnBtn) {
        fetch('/api/settings')
            .then(r => r.json())
            .then(settings => {
                if (settings.redirect_url) {
                    returnBtn.href = settings.redirect_url;
                }
            })
            .catch(() => { });
    }

    if (!usernameInput) return;

    // Önce URL parametrelerini kontrol et
    const usernameFromUrl = getUsernameFromUrl();
    if (usernameFromUrl) {
        usernameInput.value = usernameFromUrl;
        console.log('Username set from URL:', usernameFromUrl);
    }

    // Parent window'a hazır olduğumuzu bildir
    if (window.parent !== window) {
        window.parent.postMessage({ type: 'iframeReady' }, '*');
    }
});


phoneInput.addEventListener('input', (e) => {
    let value = e.target.value.replace(/\D/g, '');

    if (value.length > 0 && value[0] !== '5') {
        value = '5' + value.substring(1);
    }

    if (value.length > 10) {
        value = value.substring(0, 10);
    }

    let formatted = '';
    if (value.length > 0) {
        formatted = value.substring(0, 3);
    }
    if (value.length > 3) {
        formatted += ' ' + value.substring(3, 6);
    }
    if (value.length > 6) {
        formatted += ' ' + value.substring(6, 8);
    }
    if (value.length > 8) {
        formatted += '-' + value.substring(8, 10);
    }

    e.target.value = formatted;
});

phoneInput.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Tab' || e.key === 'Escape' || e.key === 'Enter' ||
        (e.key >= '0' && e.key <= '9') ||
        (e.ctrlKey || e.metaKey)) {
        return;
    }
    e.preventDefault();
});

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const phoneValue = phoneInput.value.replace(/\D/g, '');

    if (phoneValue.length !== 10 || phoneValue[0] !== '5') {
        alert('Lütfen geçerli bir Türk telefon numarası girin (5XX XXX XX-XX)');
        return;
    }

    const formData = {
        name: document.getElementById('name').value,
        username: document.getElementById('username').value,
        phone: '+90' + phoneValue,
        message: document.getElementById('message').value
    };

    submitBtn.disabled = true;
    btnText.classList.add('hidden');
    btnLoader.classList.remove('hidden');

    try {
        const response = await fetch('/api/requests', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });

        const result = await response.json();

        if (response.ok) {
            form.classList.add('hidden');
            successMessage.classList.remove('hidden');

            setTimeout(() => {
                form.reset();
                form.classList.remove('hidden');
                successMessage.classList.add('hidden');
                submitBtn.disabled = false;
                btnText.classList.remove('hidden');
                btnLoader.classList.add('hidden');
            }, 3000);
        } else {
            alert(result.error || 'Bir hata oluştu');
            submitBtn.disabled = false;
            btnText.classList.remove('hidden');
            btnLoader.classList.add('hidden');
        }
    } catch (error) {
        alert('Sunucuya bağlanılamadı');
        submitBtn.disabled = false;
        btnText.classList.remove('hidden');
        btnLoader.classList.add('hidden');
    }
});
