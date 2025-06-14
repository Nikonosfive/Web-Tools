const initialLat = 35.362222;
const initialLng = 138.731388;
const initialZoom = 13;

let mapObjects = [];
let mapCountSelect = document.getElementById('mapCount');
let layoutSelect = document.getElementById('layout');
let container = document.getElementById('container');
let mapSelectors = document.getElementById('mapSelectors');
let layoutControl = document.getElementById('layoutControl');

const mapTypes = {
    standard: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
    photo: 'https://cyberjapandata.gsi.go.jp/xyz/ort/{z}/{x}/{y}.jpg',
    relief: 'https://cyberjapandata.gsi.go.jp/xyz/relief/{z}/{x}/{y}.png',
    slope: 'https://cyberjapandata.gsi.go.jp/xyz/slopemap/{z}/{x}/{y}.png'
};

const mapTypeLabels = {
    standard: '標準地図',
    photo: '航空写真',
    relief: '陰影起伏図',
    slope: '傾斜量図'
};

function initMaps() {
    updateMapSelectors();
    updateLayout();
    mapCountSelect.addEventListener('change', updateMapSelectors);
    layoutSelect.addEventListener('change', updateLayout);
}

function updateMapSelectors() {
    let count = parseInt(mapCountSelect.value);
    layoutControl.style.display = count > 1 ? 'block' : 'none';
    mapSelectors.innerHTML = '';

    for (let i = 0; i < count; i++) {
        let select = document.createElement('select');
        select.className = 'mapType';
        for (let type in mapTypes) {
            let option = document.createElement('option');
            option.value = type;
            option.textContent = mapTypeLabels[type];
            select.appendChild(option);
        }
        select.addEventListener('change', updateMaps);
        mapSelectors.appendChild(select);
    }
    updateLayout();
}

function updateLayout() {
    let count = parseInt(mapCountSelect.value);
    let layout = layoutSelect.value;

    container.innerHTML = '';
    mapObjects = [];

    if (count === 1) {
        container.style.gridTemplateColumns = '1fr';
        container.style.gridTemplateRows = '1fr';
    } else if (count === 2) {
        if (layout === 'vertical') {
            container.style.gridTemplateColumns = '1fr';
            container.style.gridTemplateRows = '1fr 1fr';
        } else {
            container.style.gridTemplateColumns = '1fr 1fr';
            container.style.gridTemplateRows = '1fr';
        }
    } else if (count === 3) {
        if (layout === 'vertical') {
            container.style.gridTemplateColumns = '1fr';
            container.style.gridTemplateRows = '1fr 1fr 1fr';
        } else {
            container.style.gridTemplateColumns = '1fr 1fr';
            container.style.gridTemplateRows = '1fr 1fr';
        }
    } else if (count === 4) {
        container.style.gridTemplateColumns = '1fr 1fr';
        container.style.gridTemplateRows = '1fr 1fr';
    }

    for (let i = 0; i < count; i++) {
        let div = document.createElement('div');
        div.className = 'map';
        div.id = `map${i}`;
        container.appendChild(div);

        let mapType = mapSelectors.children[i].value;
        let map = L.map(div.id).setView([initialLat, initialLng], initialZoom);
        L.tileLayer(mapTypes[mapType], {
            attribution: "地理院地図"
        }).addTo(map);
        map.on('moveend', syncMaps);
        mapObjects.push(map);
    }
}

function updateMaps() {
    let count = parseInt(mapCountSelect.value);

    for (let i = 0; i < count; i++) {
        let mapType = mapSelectors.children[i].value;
        let map = mapObjects[i];
        map.eachLayer(function (layer) {
            map.removeLayer(layer);
        });
        L.tileLayer(mapTypes[mapType], {
            attribution: "地理院地図"
        }).addTo(map);
    }
}

function syncMaps() {
    let center = this.getCenter();
    let zoom = this.getZoom();

    mapObjects.forEach(map => {
        if (map !== this) {
            map.setView(center, zoom);
        }
    });
}

window.onload = initMaps;
