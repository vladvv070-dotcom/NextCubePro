/* Timer skin catalog. Prices and tiers are provisional until the shop launches. */
(function () {
    const tiers = [
        { id: 'basic', order: 1, name: { ru: 'Базовые', en: 'Basic' }, minPrice: 100, maxPrice: 1000 },
        { id: 'textures', order: 2, name: { ru: 'Текстуры', en: 'Textures' }, minPrice: 1001, maxPrice: 2500 },
        { id: 'animated', order: 3, name: { ru: 'Анимированные', en: 'Animated' }, minPrice: 2501, maxPrice: 5000 },
        { id: 'advanced', order: 4, name: { ru: 'Продвинутые', en: 'Advanced' }, minPrice: 5001, maxPrice: 8000 },
        { id: 'legendary', order: 5, name: { ru: 'Легендарные', en: 'Legendary' }, minPrice: 8001, maxPrice: 10000 }
    ];

    const skins = [
        {
            id: 'custom-gradient',
            tier: 'basic',
            price: 1000,
            name: { ru: 'Мой градиент', en: 'My Gradient' },
            description: {
                ru: 'Купите один раз, выберите три цвета и направление. После покупки настройки можно менять бесплатно.',
                en: 'Buy once, choose three colors and a direction. Change the settings for free after purchase.'
            },
            source: 'configurable-css-gradient',
            status: 'available'
        },
        {
            id: 'soft-cyan-pulse',
            tier: 'basic',
            price: 800,
            name: { ru: 'Голубой импульс', en: 'Soft Cyan Pulse' },
            description: {
                ru: 'Мягкое голубое свечение медленно усиливается и затихает на цифрах таймера.',
                en: 'A soft cyan glow slowly brightens and fades on the timer digits.'
            },
            source: 'css-glow-pulse',
            status: 'concept'
        },
        {
            id: 'neon-sign',
            tier: 'animated',
            price: 3000,
            name: { ru: 'Неоновая вывеска', en: 'Neon Sign' },
            description: {
                ru: 'Розовое неоновое свечение и мерцание цифр в стиле вывески.',
                en: 'Pink neon glow and sign-like flicker on the timer digits.'
            },
            source: 'css-animation',
            status: 'concept'
        },
        {
            id: 'blazing-glow',
            tier: 'animated',
            price: 3200,
            name: { ru: 'Пылающее свечение', en: 'Blazing Glow' },
            description: {
                ru: 'Цифры мерцают тёплым красно-оранжевым и жёлтым свечением, как раскалённый огонь.',
                en: 'The digits flicker with a warm red, orange, and yellow glow like blazing fire.'
            },
            source: 'css-text-shadow-animation',
            status: 'concept'
        },
        {
            id: 'linear-shine',
            tier: 'animated',
            price: 2600,
            name: { ru: 'Сияющий блик', en: 'Linear Shine' },
            description: {
                ru: 'Светлый градиентный блик непрерывно проходит по цифрам таймера.',
                en: 'A bright gradient highlight continuously sweeps across the timer digits.'
            },
            source: 'css-animation',
            status: 'concept'
        },
        {
            id: 'spectrum-glow',
            tier: 'advanced',
            price: 6500,
            name: { ru: 'Спектральное свечение', en: 'Spectrum Glow' },
            description: {
                ru: 'Переливающийся цветовой градиент с SVG-размытием и насыщенным свечением вокруг цифр.',
                en: 'A shifting color gradient with SVG blur and saturated glow around the digits.'
            },
            source: 'svg-filter-css-animation',
            status: 'concept'
        },
        {
            id: 'flowing-gradient',
            tier: 'animated',
            price: 3500,
            name: { ru: 'Живой градиент', en: 'Flowing Gradient' },
            description: {
                ru: 'Бесшовный градиент медленно проходит сквозь цифры таймера.',
                en: 'A seamless gradient slowly flows through the timer digits.'
            },
            source: 'svg-pattern-animation',
            status: 'concept'
        },
        {
            id: 'shimmering-neon',
            tier: 'animated',
            price: 4400,
            name: { ru: 'Мерцающий неон', en: 'Shimmering Neon' },
            description: {
                ru: 'Неоновый градиент с движущимся бликом и мягким световым ореолом внутри цифр.',
                en: 'A neon gradient with a moving shimmer and soft glow inside the digits.'
            },
            source: 'css-shimmering-neon',
            status: 'available'
        },
        {
            id: 'corgo-bounce',
            tier: 'advanced',
            price: 7500,
            name: { ru: 'Хроматический отскок', en: 'Chromatic Bounce' },
            description: {
                ru: 'Цифры подпрыгивают по очереди; градиент и контрастные цветные тени создают многослойный эффект.',
                en: 'Digits bounce in sequence, with a gradient and offset color shadows creating a layered effect.'
            },
            source: 'css-per-character-animation',
            status: 'concept'
        },
        {
            id: 'holographic-foil',
            tier: 'advanced',
            price: 7800,
            name: { ru: 'Голографическая фольга', en: 'Holographic Foil' },
            description: {
                ru: 'Радужные голографические полосы и мягкий блик, следующий за курсором.',
                en: 'Rainbow holographic bands with a soft highlight that follows the pointer.'
            },
            source: 'css-pointer-reactive-gradient',
            status: 'concept'
        },
        {
            id: 'fluid-gradient',
            tier: 'advanced',
            price: 8000,
            name: { ru: 'Жидкий градиент', en: 'Fluid Gradient' },
            description: {
                ru: 'Переливающаяся цветная поверхность внутри цифр смещается вслед за указателем.',
                en: 'A flowing multicolor surface inside the digits shifts with the pointer.'
            },
            source: 'pointer-reactive-fluid-gradient',
            status: 'available'
        },
        {
            id: 'legendary-metal-fx',
            tier: 'legendary',
            price: 10000,
            name: { ru: 'Жидкий металл: мастерская', en: 'Liquid Metal FX Workshop' },
            description: {
                ru: '40 металлических пресетов, WebGL-шейдер и отдельные настраиваемые ячейки. Каждый слот покупается отдельно.',
                en: '40 metal presets, a WebGL shader, and separately purchased configurable slots.'
            },
            source: 'webgl-liquid-metal-shader',
            multiPurchase: true,
            status: 'concept'
        },
        {
            id: 'fire-fill',
            tier: 'advanced',
            price: 7900,
            name: { ru: 'Живое пламя', en: 'Living Flame' },
            description: {
                ru: 'Анимированное пламя заполняет цифры таймера; огонь остаётся внутри их контура.',
                en: 'Animated flames fill the timer digits and stay clipped to their shape.'
            },
            source: 'animated-svg-texture',
            assetType: 'animated-svg',
            asset: './images/skins/fire-fill.svg',
            status: 'concept'
        },
        {
            id: 'minecraft-dirt',
            tier: 'textures',
            price: 1200,
            name: { ru: 'Земля Minecraft', en: 'Minecraft Dirt' },
            description: {
                ru: 'Пиксельная коричневая текстура земли Minecraft внутри цифр таймера.',
                en: 'The pixelated brown Minecraft dirt texture fills the timer digits.'
            },
            source: 'image-texture',
            asset: './images/skins/minecraft-dirt.jpg',
            status: 'concept'
        },
        {
            id: 'walnut-veneer',
            tier: 'textures',
            price: 1700,
            name: { ru: 'Ореховый шпон', en: 'Walnut Veneer' },
            description: {
                ru: 'Тёплая натуральная древесная фактура на цифрах таймера.',
                en: 'A warm, natural walnut grain across the timer digits.'
            },
            source: 'image-texture',
            asset: './images/skins/walnut-veneer.webp',
            status: 'concept'
        },
        {
            id: 'rock-wall',
            tier: 'textures',
            price: 2000,
            name: { ru: 'Каменная кладка', en: 'Stone Wall' },
            description: {
                ru: 'Шероховатая фактура тёмной каменной стены внутри цифр.',
                en: 'A rough, dark stone-wall texture inside the digits.'
            },
            source: 'image-texture',
            asset: './images/skins/rock-wall.webp',
            status: 'concept'
        },
        {
            id: 'rusty-metal',
            tier: 'textures',
            price: 2200,
            name: { ru: 'Ржавая сталь', en: 'Rusty Steel' },
            description: {
                ru: 'Фактура потёртого ржавого металла заполняет цифры таймера.',
                en: 'A worn, rusty metal texture fills the timer digits.'
            },
            source: 'image-texture',
            asset: './images/skins/rusty-metal.webp',
            status: 'concept'
        },
        {
            id: 'golden-lava',
            tier: 'textures',
            price: 2500,
            name: { ru: 'Золотая лава', en: 'Golden Lava' },
            description: {
                ru: 'Золотистые светящиеся трещины и расплавленная фактура внутри цифр таймера.',
                en: 'Glowing golden cracks and a molten surface fill the timer digits.'
            },
            source: 'image-texture',
            asset: './images/skins/golden-lava.jpg',
            status: 'concept'
        }
    ];

    window.TIMER_SKIN_CATALOG = { tiers, skins, maxPrice: 10000 };
})();
