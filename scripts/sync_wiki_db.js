/**
 * War Thunder Wiki Database Synchronizer
 * Автоматическая синхронизация базы техники с официальной Вики War Thunder (wiki.warthunder.ru)
 * Поддерживает: Авиацию, Наземную технику, Вертолеты, Большой и Малый флот.
 */
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'global_db.json');
const MIN_DB_PATH = path.join(__dirname, '..', 'global_db.min.json');

const NATION_MAP = {
    'usa': 'country_usa',
    'germany': 'country_germany',
    'ussr': 'country_ussr',
    'britain': 'country_britain',
    'japan': 'country_japan',
    'china': 'country_china',
    'italy': 'country_italy',
    'france': 'country_france',
    'sweden': 'country_sweden',
    'israel': 'country_israel'
};

const CLASS_MAP = {
    // Авиация
    'fighter': 'exp_fighter',
    'assault': 'exp_assault',
    'bomber': 'exp_bomber',
    // Наземка
    'medium_tank': 'exp_tank',
    'light_tank': 'exp_tank',
    'heavy_tank': 'exp_heavy_tank',
    'tank_destroyer': 'exp_tank_destroyer',
    'spaa': 'exp_SPAA',
    // Вертолеты
    'helicopter': 'exp_helicopter',
    // Флот
    'destroyer': 'exp_destroyer',
    'cruiser': 'exp_cruiser',
    'battleship': 'exp_cruiser',
    'torpedo_boat': 'exp_torpedo_boat',
    'gun_boat': 'exp_gun_boat'
};

function decodeBr(index) {
    if (index === null || index === undefined || index < 0) return null;
    const major = Math.floor(index / 3) + 1;
    const remainder = index % 3;
    const fraction = remainder === 0 ? 0.0 : (remainder === 1 ? 0.3 : 0.7);
    return Math.round((major + fraction) * 10) / 10;
}

async function fetchWikiCategory(category, unitMoveType) {
    console.log(`\n⏳ Загрузка категории: ${category}...`);
    const url = `https://wiki.warthunder.ru/${category}?v=l`;
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WarThunderSquadronHub/4.6'
        }
    });
    if (!res.ok) {
        console.warn(`[WARN] Ошибка загрузки ${url}: ${res.status}`);
        return [];
    }
    const html = await res.text();
    const startStr = 'window.WT_UnitList = \'';
    const startPos = html.indexOf(startStr);
    if (startPos === -1) {
        console.warn(`[WARN] window.WT_UnitList не найден для ${category}`);
        return [];
    }

    const jsonStart = startPos + startStr.length;
    const endPos = html.indexOf('\';', jsonStart);
    const rawJson = html.substring(jsonStart, endPos).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    const unitList = JSON.parse(rawJson);
    console.log(`✅ Найдено ${unitList.length} единиц техники в [${category}]`);

    return unitList.map(item => {
        const id = item[0];
        const name = (item[1] || id).replace(/\u00a0/g, ' ').trim();
        const countryKey = NATION_MAP[item[2]] || ('country_' + item[2]);
        const rank = item[3] || 1;
        const brs = item[4] || {};
        const isPrem = item[5] === 1;
        
        let unitClass = 'exp_tank';
        if (item[7] && item[7][0] && item[7][0][0]) {
            unitClass = CLASS_MAP[item[7][0][0]] || item[7][0][0];
        }

        return {
            id,
            name,
            country: countryKey,
            rank,
            unitClass,
            unitMoveType,
            ab: decodeBr(brs.ab),
            rb: decodeBr(brs.rb),
            trb: decodeBr(brs.trb),
            sb: decodeBr(brs.sb),
            tsb: decodeBr(brs.tsb),
            isPrem
        };
    });
}

async function runSync() {
    console.log('====================================================');
    console.log('🚀 War Thunder Wiki Synchronizer v4.6');
    console.log('====================================================');

    let globalDb = {};
    if (fs.existsSync(DB_PATH)) {
        globalDb = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    }
    const initialCount = Object.keys(globalDb).length;
    console.log(`📊 Текущее количество единиц в базе: ${initialCount}`);

    const categories = [
        { cat: 'aviation', type: 'air' },
        { cat: 'ground', type: 'tank' },
        { cat: 'helicopters', type: 'helicopter' },
        { cat: 'ships', type: 'ship' },
        { cat: 'boats', type: 'fast_ship' }
    ];

    let totalAdded = 0;
    let totalUpdatedBr = 0;
    let totalUpdatedRank = 0;

    for (const c of categories) {
        try {
            const units = await fetchWikiCategory(c.cat, c.type);
            for (const u of units) {
                const existing = globalDb[u.id];
                if (existing) {
                    // Проверяем изменение РБ БР
                    if (u.rb !== null && existing.battleRatingHistorical !== u.rb) {
                        existing.battleRatingHistorical = u.rb;
                        totalUpdatedBr++;
                    }
                    // Для авиации обновляем ТРБ БР
                    if (u.trb !== null) {
                        existing.battleRatingTankHistorical = u.trb;
                    }
                    if (u.rank && existing.rank !== u.rank) {
                        existing.rank = u.rank;
                        totalUpdatedRank++;
                    }
                    if (u.unitClass && (!existing.unitClass || existing.unitClass === 'exp_zero')) {
                        existing.unitClass = u.unitClass;
                    }
                    if (!existing.country && u.country) {
                        existing.country = u.country;
                    }
                    if (u.name && (!existing.name || existing.name.length < u.name.length)) {
                        existing.name = u.name;
                    }
                } else {
                    // Новая машина
                    globalDb[u.id] = {
                        name: u.name,
                        unitClass: u.unitClass,
                        unitMoveType: u.unitMoveType,
                        rank: u.rank,
                        battleRatingArcade: u.ab || u.rb || 1.0,
                        battleRatingHistorical: u.rb || 1.0,
                        battleRatingSimulation: u.sb || u.rb || 1.0,
                        battleRatingTankHistorical: u.trb || (u.unitMoveType === 'air' ? u.rb : null),
                        battleRatingTankSimulation: u.tsb || null,
                        country: u.country,
                        isPrem: u.isPrem,
                        isEvent: false,
                        isGift: false,
                        isNormal: !u.isPrem
                    };
                    totalAdded++;
                }
            }
        } catch (err) {
            console.error(`Ошибка при обработке ${c.cat}:`, err.message);
        }
    }

    const finalCount = Object.keys(globalDb).length;
    console.log('\n====================================================');
    console.log('📈 Результаты синхронизации:');
    console.log(`  ➕ Добавлено новых машин: ${totalAdded}`);
    console.log(`  🔄 Обновлено БР: ${totalUpdatedBr}`);
    console.log(`  🎖️ Обновлено рангов: ${totalUpdatedRank}`);
    console.log(`  📦 Итоговое число техники в базе: ${finalCount} (было ${initialCount})`);
    console.log('====================================================');

    // Сохранение обновленной базы
    fs.writeFileSync(DB_PATH, JSON.stringify(globalDb, null, 2), 'utf8');
    console.log(`[OK] global_db.json сохранен (${(fs.statSync(DB_PATH).size / 1024).toFixed(1)} KB)`);

    // Генерация минифицированной версии
    fs.writeFileSync(MIN_DB_PATH, JSON.stringify(globalDb), 'utf8');
    console.log(`[OK] global_db.min.json сохранен (${(fs.statSync(MIN_DB_PATH).size / 1024).toFixed(1)} KB)`);
}

runSync();
