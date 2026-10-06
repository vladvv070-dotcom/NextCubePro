/* Achievements, daily tasks, rewards and inventory. Catalog lives in progression-data.js. */
(function () {
    const STORAGE_KEY = 'progressionStateV1';
    const DAY_MS = 86400000;

    class ProgressionSystem {
        constructor(timer, settingsManager) {
            this.timer = timer;
            this.settingsManager = settingsManager;
            this.catalog = window.PROGRESSION_CATALOG;
            this.titleCatalog = window.TITLE_CATALOG || { tiers: {}, titles: [] };
            this.state = this._load();
            this._timer = null;
            this.sessionStartedAt = Date.now();
            this._applyTimerSkin();
        }

        _defaultState() {
            return { version: 1, rewardLedger: {}, inventoryLedger: {}, unlocked: {}, events: {}, frozenDays: {}, freezeCancelledDays: {}, activeBoostUntil: 0, ownedTitles: {}, equippedTitle: null, titleUpdatedAt: 0, ownedSkins: {}, equippedSkin: null, skinUpdatedAt: 0, skinGradient: { colors: ['#ff5a8a', '#9b5de5', '#00d4ff'], direction: 90, updatedAt: 0 }, legendaryMetalSlots: [], equippedMetalSlotId: null, metalFxUpdatedAt: 0, daily: null, updatedAt: 0 };
        }
        _load() { return { ...this._defaultState(), ...(AppStorage.getJSON(STORAGE_KEY, {}) || {}) }; }
        _save(push = true) {
            this.state.updatedAt = Date.now();
            AppStorage.setJSON(STORAGE_KEY, this.state);
            // Debounced + content-hashed in sync.js: several changes in a row = one write.
            if (push) { const sync = window.AppSync; if (sync?.queueProgressionPush) sync.queueProgressionPush(); else sync?.pushProgressionNow?.(); }
            this.render();
            this._applyTimerSkin();
            window.dispatchEvent(new CustomEvent('titlechange', { detail: { title: this.getEquippedTitle() } }));
        }
        exportState() { return JSON.parse(JSON.stringify(this.state)); }
        clearLocalState() { this.state=this._defaultState();AppStorage.setJSON(STORAGE_KEY,this.state);this.ensureDaily();this._applyTimerSkin();this.render(); }
        mergeCloudState(remote) {
            if (!remote) return;
            const local = this.state;
            const merged = { ...this._defaultState(), ...(Number(remote.updatedAt) > Number(local.updatedAt) ? remote : local) };
            merged.rewardLedger = { ...(remote.rewardLedger || {}), ...(local.rewardLedger || {}) };
            merged.inventoryLedger = { ...(remote.inventoryLedger || {}), ...(local.inventoryLedger || {}) };
            merged.unlocked = { ...(remote.unlocked || {}), ...(local.unlocked || {}) };
            merged.events = { ...(remote.events || {}), ...(local.events || {}) };
            merged.frozenDays = { ...(remote.frozenDays || {}), ...(local.frozenDays || {}) };
            merged.freezeCancelledDays = { ...(remote.freezeCancelledDays || {}), ...(local.freezeCancelledDays || {}) };
            merged.ownedTitles = { ...(remote.ownedTitles || {}), ...(local.ownedTitles || {}) };
            merged.ownedSkins = { ...(remote.ownedSkins || {}), ...(local.ownedSkins || {}) };
            const metalSlots=new Map();[...(remote.legendaryMetalSlots||[]),...(local.legendaryMetalSlots||[])].forEach(slot=>{const previous=metalSlots.get(slot.id);if(!previous||Number(slot.updatedAt||0)>=Number(previous.updatedAt||0))metalSlots.set(slot.id,slot);});
            merged.legendaryMetalSlots=[...metalSlots.values()];
            if(Number(remote.metalFxUpdatedAt||0)>Number(local.metalFxUpdatedAt||0)){merged.equippedMetalSlotId=remote.equippedMetalSlotId||null;merged.metalFxUpdatedAt=Number(remote.metalFxUpdatedAt||0);}
            else{merged.equippedMetalSlotId=local.equippedMetalSlotId||null;merged.metalFxUpdatedAt=Number(local.metalFxUpdatedAt||0);}
            if(Number(remote.skinUpdatedAt||0)>Number(local.skinUpdatedAt||0)){merged.equippedSkin=remote.equippedSkin||null;merged.skinUpdatedAt=Number(remote.skinUpdatedAt||0);}
            else{merged.equippedSkin=local.equippedSkin||null;merged.skinUpdatedAt=Number(local.skinUpdatedAt||0);}
            if(Number(remote.skinGradient?.updatedAt||0)>Number(local.skinGradient?.updatedAt||0)) merged.skinGradient=remote.skinGradient;
            else merged.skinGradient=local.skinGradient||this._defaultState().skinGradient;
            if (Number(remote.titleUpdatedAt || 0) > Number(local.titleUpdatedAt || 0)) {
                merged.equippedTitle = remote.equippedTitle || null;
                merged.titleUpdatedAt = Number(remote.titleUpdatedAt || 0);
            } else {
                merged.equippedTitle = local.equippedTitle || null;
                merged.titleUpdatedAt = Number(local.titleUpdatedAt || 0);
            }
            merged.activeBoostUntil = Math.max(Number(remote.activeBoostUntil)||0,Number(local.activeBoostUntil)||0);
            if (remote.daily?.date === local.daily?.date) {
                const currentOwner=window.CubeAuth?.getCurrentUser?.()?.uid;
                if(currentOwner&&remote.daily?.ownerId===currentOwner&&local.daily?.ownerId!==currentOwner) merged.daily=remote.daily;
                else if(currentOwner&&local.daily?.ownerId===currentOwner&&remote.daily?.ownerId!==currentOwner) merged.daily=local.daily;
                else merged.daily = Number(remote.daily.updatedAt || 0) > Number(local.daily.updatedAt || 0) ? remote.daily : local.daily;
                const sameAssignment=remote.daily?.ownerId===local.daily?.ownerId&&JSON.stringify(remote.daily?.ids||[])===JSON.stringify(local.daily?.ids||[]);
                if(sameAssignment){
                    merged.daily.completed = { ...(remote.daily.completed || {}), ...(local.daily.completed || {}) };
                    merged.daily.rewarded = { ...(remote.daily.rewarded || {}), ...(local.daily.rewarded || {}) };
                    merged.daily.bonusClaimed = !!(remote.daily.bonusClaimed || local.daily.bonusClaimed);
                }
            } else if (remote.daily && (!local.daily || remote.daily.date > local.daily.date)) merged.daily = remote.daily;
            this.state = merged;
            AppStorage.setJSON(STORAGE_KEY, merged);
            this._applyTimerSkin();
            this.ensureDaily();
            window.dispatchEvent(new CustomEvent('titlechange', { detail: { title: this.getEquippedTitle() } }));
            this.scheduleEvaluation('cloud');
        }

        get coins() { return Object.values(this.state.rewardLedger || {}).reduce((n, x) => n + Number(x.amount || 0), 0); }
        get inventory() {
            const out = { freezes: 0, coinBoosters: 0, dnfInsurance: 0 };
            Object.values(this.state.inventoryLedger || {}).forEach(x => { if (x.type in out) out[x.type] += Number(x.amount || 0); });
            return out;
        }
        _normalizedGradient(){
            const value=this.state.skinGradient||{},defaults=['#ff5a8a','#9b5de5','#00d4ff'];
            const colors=Array.from({length:3},(_,i)=>/^#[\da-f]{6}$/i.test(value.colors?.[i]||'')?value.colors[i]:defaults[i]);
            return {colors,direction:Math.max(0,Math.min(360,Number(value.direction)||0))};
        }
        _metalPresets(){return window.LEGENDARY_METAL_PRESETS||[];}
        _defaultMetalConfig(){const p=this._metalPresets().find(x=>x.name==='Obsidian')||this._metalPresets()[0];return {presetName:p?.name||'Obsidian',colors:[...(p?.colors||['#111','#222','#333','#000','#101'])],scale:p?.physics.scale??6,complexity:p?.physics.complexity??1,contrast:p?.physics.contrast??1.8,flow:p?.physics.flow??0,hue:0,speed:.5,lightMode:false};}
        _metalSlot(id=this.state.equippedMetalSlotId){return (this.state.legendaryMetalSlots||[]).find(x=>x.id===id)||null;}
        _metalConfigForPreset(name){const p=this._metalPresets().find(x=>x.name===name),previous=this.metalFxDraft||this._defaultMetalConfig();return p?{...this._defaultMetalConfig(),presetName:p.name,colors:[...p.colors],scale:p.physics.scale,complexity:p.physics.complexity,contrast:p.physics.contrast,flow:p.physics.flow,speed:previous.speed,lightMode:previous.lightMode}:this._defaultMetalConfig();}
        _escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
        _metalLabel(ru,en){return this._lang()==='ru'?ru:en;}
        openLegendaryMetal(){const ru=this._lang()==='ru';const timerDisplay=DOM('timerDisplay');if(timerDisplay)DOM('metalFxOverlay').style.setProperty('--timer-skin-font-family',getComputedStyle(timerDisplay).fontFamily);DOM('metalFxTitle').textContent=ru?'Мастерская жидкого металла':'Liquid Metal FX Workshop';DOM('metalFxLibraryCopy').textContent=ru?'Каждая ячейка настраивается один раз после покупки. Сохранённый вариант можно использовать, но изменить его уже нельзя.':'Configure each slot once after purchase. Saved slots can be used but cannot be edited.';DOM('metalFxBuyMore').textContent=ru?'Купить новую ячейку · 10 000 монет':'Buy a new slot · 10,000 coins';DOM('metalFxBuyMore').disabled=this.coins<10000;DOM('metalFxPresetLabel').textContent=ru?'Пресет эффекта':'Effect preset';DOM('metalFxScaleLabel').textContent=ru?'Масштаб':'Scale';DOM('metalFxComplexityLabel').textContent=ru?'Сложность':'Complexity';DOM('metalFxContrastLabel').textContent=ru?'Контраст':'Contrast';DOM('metalFxHueLabel').textContent=ru?'Сдвиг цвета':'Color Shift';DOM('metalFxSpeedLabel').textContent=ru?'Скорость потока':'Flow Speed';DOM('metalFxMode').textContent=ru?'Светлый режим':'Light Mode';DOM('metalFxTweak').textContent=ru?'Настроить FX':'Tweak FX';const sel=DOM('metalFxPresetSelect');sel.innerHTML=this._metalPresets().map(p=>`<option value="${this._escapeHtml(p.name)}">${this._escapeHtml(p.name)}</option>`).join('');this.renderLegendaryMetalSlots();DOM('metalFxLibraryPanel').classList.remove('hidden');DOM('metalFxEditorPanel').classList.add('hidden');DOM('metalFxBack').classList.add('hidden');DOM('metalFxOverlay').classList.add('visible');this.metalFxEditingSlotId=null;this.metalFxDraft=null;}
        renderLegendaryMetalSlots(){const host=DOM('metalFxSlots');if(!host)return;const ru=this._lang()==='ru',slots=this.state.legendaryMetalSlots||[],active=this.state.equippedMetalSlotId;host.innerHTML=slots.length?slots.map((slot,i)=>{const c=slot.config||this._defaultMetalConfig(),configured=slot.configured!==false,colors=(c.colors||[]).slice(0,4),stops=colors.map((x,j)=>`${x} ${Math.round(j/Math.max(1,colors.length-1)*100)}%`).join(', '),id=this._escapeHtml(slot.id);const action=configured?(active===slot.id?`<button type="button" disabled class="is-current">${ru?'Используется':'In use'}</button>`:`<button type="button" data-equip-metal-slot="${id}">${ru?'Использовать':'Use'}</button>`):`<button type="button" data-configure-metal-slot="${id}">${ru?'Завершить настройку':'Finish setup'}</button>`;return `<article class="metal-fx-slot${active===slot.id?' is-equipped':''}"><div class="metal-fx-slot-preview"><span style="--metal-preview-gradient:linear-gradient(110deg,${stops||'#111,#ddd'})">12.34</span></div><strong>${ru?'Ячейка':'Slot'} ${String(i+1).padStart(2,'0')}</strong><small>${this._escapeHtml(c.presetName||'Obsidian')}${configured?'':` · ${ru?'не настроена':'setup needed'}`}</small><div class="metal-fx-slot-actions">${action}</div></article>`;}).join(''):`<p class="metal-fx-empty">${ru?'Купленных ячеек пока нет. Купите первую, чтобы выбрать пресет и настроить эффект.':'No slots yet. Buy one to select a preset and configure the effect.'}</p>`;}
        configureLegendaryMetalSlot(id){const slot=this._metalSlot(id);if(!slot||slot.configured!==false)return;this.metalFxEditingSlotId=id;this.metalFxDraft=JSON.parse(JSON.stringify(slot.config||this._defaultMetalConfig()));const ru=this._lang()==='ru';DOM('metalFxTitle').textContent=ru?`Настройка: ${this.metalFxDraft.presetName}`:`Setup: ${this.metalFxDraft.presetName}`;DOM('metalFxLibraryPanel').classList.add('hidden');DOM('metalFxEditorPanel').classList.remove('hidden');DOM('metalFxBack').classList.remove('hidden');DOM('metalFxSettings').classList.add('hidden');DOM('metalFxPresetSelect').value=this.metalFxDraft.presetName;DOM('metalFxSave').textContent=ru?'Сохранить и завершить':'Save and finish';DOM('metalFxSaveNote').textContent=ru?'После сохранения эту ячейку нельзя будет перенастроить.':'This slot cannot be reconfigured after saving.';this._syncMetalFxControls();const host=DOM('metalFxPreview'),ok=window.LegendaryMetalFx?.mount(host,DOM('metalFxPreviewText'),this.metalFxDraft,'12.34');host.classList.toggle('metal-fx-fallback',!ok);host.style.setProperty('--metal-fallback-gradient',`linear-gradient(110deg,${(this.metalFxDraft.colors||[]).join(',')})`);}
        _syncMetalFxControls(){const c=this.metalFxDraft||this._defaultMetalConfig(),set=(id,v)=>{const e=DOM(id);if(e)e.value=v;};set('metalFxPresetSelect',c.presetName);set('metalFxScale',c.scale);set('metalFxComplexity',c.complexity);set('metalFxContrast',c.contrast);set('metalFxHue',c.hue);set('metalFxSpeed',c.speed);DOM('metalFxMode').textContent=c.lightMode?this._metalLabel('Тёмный режим','Dark Mode'):this._metalLabel('Светлый режим','Light Mode');DOM('metalFxPreviewCaption').textContent=this._metalLabel(`Пресет «${c.presetName}» · нажмите на цифры, чтобы выбрать следующий` ,`Preset “${c.presetName}” · click the digits to cycle`);this._updateMetalFxOutputs();}
        _updateMetalFxOutputs(){const c=this.metalFxDraft||{},set=(id,v)=>{if(DOM(id))DOM(id).textContent=v;};set('metalFxScaleValue',Number(c.scale||0).toFixed(1));set('metalFxComplexityValue',Number(c.complexity||0).toFixed(1));set('metalFxContrastValue',Number(c.contrast||0).toFixed(1));set('metalFxHueValue',`${Math.round(Number(c.hue||0)*57.29)}°`);set('metalFxSpeedValue',`${Math.round(Number(c.speed||0)*200)}%`);}
        _updateMetalFxDraft(key,value){if(!this.metalFxDraft)return;if(key==='presetName'){this.metalFxDraft=this._metalConfigForPreset(value);this._syncMetalFxControls();}else this.metalFxDraft[key]=value;if(key==='lightMode')this._syncMetalFxControls();window.LegendaryMetalFx?.setConfig(this.metalFxDraft);const host=DOM('metalFxPreview');host?.style.setProperty('--metal-fallback-gradient',`linear-gradient(110deg,${(this.metalFxDraft.colors||[]).join(',')})`);}
        saveLegendaryMetalConfiguration(){const slot=this._metalSlot(this.metalFxEditingSlotId);if(!slot||slot.configured!==false||!this.metalFxDraft)return false;const now=Date.now();slot.config=JSON.parse(JSON.stringify(this.metalFxDraft));slot.configured=true;slot.updatedAt=now;this.state.metalFxUpdatedAt=now;this.metalFxEditingSlotId=null;this.metalFxDraft=null;window.LegendaryMetalFx?.unmount();this._save();this.renderSkinsCatalog(this._lang()==='ru');this.openLegendaryMetal();this._toast(this._lang()==='ru'?'Настройка сохранена. Теперь ячейку можно использовать.':'Setup saved. The slot is now ready to use.','success');return true;}
        equipLegendaryMetalSlot(id){const slot=this._metalSlot(id);if(!slot||slot.configured===false)return false;const now=Date.now();this.state.equippedMetalSlotId=id;this.state.equippedSkin='legendary-metal-fx';this.state.ownedSkins={...(this.state.ownedSkins||{}),'legendary-metal-fx':this.state.ownedSkins?.['legendary-metal-fx']||now};this.state.metalFxUpdatedAt=now;this.state.skinUpdatedAt=now;this._save();this.renderSkinsCatalog(this._lang()==='ru');DOM('metalFxOverlay').classList.remove('visible');return true;}
        closeLegendaryMetal(){this.metalFxEditingSlotId=null;this.metalFxDraft=null;DOM('metalFxOverlay').classList.remove('visible');window.LegendaryMetalFx?.unmount();this._applyTimerSkin();}
        _applyTimerSkin(){
            const display=DOM('timerDisplay');if(!display)return;
            const owned=this.state.ownedSkins||{},skins=window.TIMER_SKIN_CATALOG?.skins||[];
            const activeId=owned[this.state.equippedSkin]?this.state.equippedSkin:null;
            const active=skins.find(skin=>skin.id===activeId),isGradient=activeId==='custom-gradient',isHolographic=activeId==='holographic-foil',isBlazing=activeId==='blazing-glow',isCyanPulse=activeId==='soft-cyan-pulse',isNeon=activeId==='neon-sign',isShimmering=activeId==='shimmering-neon',isLinearShine=activeId==='linear-shine',isSpectrum=activeId==='spectrum-glow',isFlowing=activeId==='flowing-gradient',isCorgo=activeId==='corgo-bounce',isFluid=activeId==='fluid-gradient',isMetal=activeId==='legendary-metal-fx',metalSlot=isMetal?this._metalSlot():null,isFire=active?.assetType==='animated-svg',isImage=!!active?.asset&&!isFire;
            display.classList.toggle('timer-skin-custom-gradient',isGradient);
            display.classList.toggle('timer-skin-holographic',isHolographic);
            display.classList.toggle('timer-skin-blazing',isBlazing);
            display.classList.toggle('timer-skin-cyan-pulse',isCyanPulse);
            display.classList.toggle('timer-skin-neon-sign',isNeon);
            display.classList.toggle('timer-skin-shimmering-neon',isShimmering);
            display.classList.toggle('timer-skin-linear-shine',isLinearShine);
            display.classList.toggle('timer-skin-spectrum-glow',isSpectrum);
            display.classList.toggle('timer-skin-flowing-gradient',isFlowing);
            display.classList.toggle('timer-skin-corgo-bounce',isCorgo);
            display.classList.toggle('timer-skin-fluid-hover',isFluid);
            display.classList.toggle('timer-skin-svg-hidden',isFlowing);
            display.classList.toggle('timer-skin-metal-fx',isMetal&&!!metalSlot);
            display.classList.toggle('timer-skin-image-texture',isImage);
            display.classList.toggle('timer-skin-fire-fill',isFire);
            if(isGradient){const {colors,direction}=this._normalizedGradient();display.style.setProperty('--custom-timer-gradient',`linear-gradient(${direction}deg, ${colors.join(', ')})`);}
            else display.style.removeProperty('--custom-timer-gradient');
            if(isImage||isFire)display.style.setProperty('--timer-skin-image',`url("${active.asset}")`);
            else display.style.removeProperty('--timer-skin-image');
            const fluidHost=display.closest('.timer-container');
            if(isFluid&&fluidHost){fluidHost.classList.add('timer-fluid-hover-host');const ready=window.FluidTextHover?.mount(fluidHost,display)||false;fluidHost.classList.toggle('fluid-text-hover-fallback',!ready);display.classList.toggle('timer-skin-svg-hidden',ready);}
            else{fluidHost?.classList.remove('timer-fluid-hover-host','fluid-text-hover-fallback');if(!isFlowing)display.classList.remove('timer-skin-svg-hidden');window.FluidTextHover?.unmount(fluidHost);}
            window.TimerSkinEffects?.apply(activeId,display);
            if(isMetal&&metalSlot){const ok=window.LegendaryMetalFx?.mount(display,display,metalSlot.config);display.classList.toggle('metal-fx-fallback',!ok);display.style.setProperty('--metal-fallback-gradient',`linear-gradient(110deg,${(metalSlot.config?.colors||[]).join(',')})`);}
            else{display.classList.remove('metal-fx-fallback');display.style.removeProperty('--metal-fallback-gradient');if(window.LegendaryMetalFx?.host===display)window.LegendaryMetalFx.unmount();}
        }
        _updateHolographicPointer(element,event){
            const rect=element.getBoundingClientRect();if(!rect.width||!rect.height)return;
            const x=Math.max(0,Math.min(100,(event.clientX-rect.left)/rect.width*100));
            const y=Math.max(0,Math.min(100,(event.clientY-rect.top)/rect.height*100));
            element.style.setProperty('--holo-x',`${x}%`);element.style.setProperty('--holo-y',`${y}%`);
        }
        _saveGradientFromControls(){
            const host=DOM('shopSkinsTiers');if(!host||!this.state.ownedSkins?.['custom-gradient'])return;
            const colors=[...host.querySelectorAll('[data-gradient-color]')].map(input=>input.value);
            const direction=Number(host.querySelector('[data-gradient-direction]')?.value??90);
            this.state.skinGradient={colors,direction,updatedAt:Date.now()};
            this.state.updatedAt=Date.now();
            AppStorage.setJSON(STORAGE_KEY,this.state);
            const sync=window.AppSync;if(sync?.queueProgressionPush)sync.queueProgressionPush();else sync?.pushProgressionNow?.();
            this._applyTimerSkin();
            const preview=host.querySelector('.skin-custom-gradient');if(preview)preview.style.setProperty('--custom-timer-gradient',`linear-gradient(${direction}deg, ${colors.join(', ')})`);
            const angle=host.querySelector('[data-gradient-angle]');if(angle)angle.textContent=`${direction}°`;
        }
        getFrozenDays() {
            const cancelled = this.state.freezeCancelledDays || {};
            return new Set(Object.keys(this.state.frozenDays || {}).filter(day => !cancelled[day]));
        }
        isBoostActive() { return Number(this.state.activeBoostUntil) > Date.now(); }
        _rewardAmount(amount) { return Number(amount) * (this.isBoostActive() ? 2 : 1); }
        _lang() { return getLang() === 'ru' ? 'ru' : 'en'; }
        _text(obj) { return obj?.[this._lang()] || obj?.en || obj?.ru || ''; }
        _assetIcon(type, className = 'economy-icon') {
            const files = { coins: 'coin.png', freezes: 'streak-freeze.png', dnfInsurance: 'dnf-insurance.png', coinBoosters: 'coin-booster.png' };
            return files[type] ? `<img class="${className}" src="./images/shop/${files[type]}" alt="">` : '';
        }
        getTitle(id = this.state.equippedTitle) { return this.titleCatalog.titles.find(title => title.id === id) || null; }
        getEquippedTitle() { return this.getTitle(); }
        _titleMarkup(title, className = '') {
            if (!title) return '';
            if(title.tier==='absolute'){
                const glyphs=this._absoluteGlyphs();
                const chars=Array.from({length:9},()=>glyphs[Math.floor(Math.random()*glyphs.length)]);
                return `<span class="title-absolute-wrapper ${className}"><span class="title-absolute-container title-visual title-absolute">${chars.map(char=>`<span class="title-absolute-char">${char}</span>`).join('')}</span></span>`;
            }
            const label=this._text(title.name),lengthClass=label.length>26?'title-extra-long':label.length>20?'title-long':'';
            return `<span class="title-visual title-${title.tier} ${lengthClass} ${className}">${label}</span>`;
        }
        _absoluteGlyphs(){return Array.from('ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛈᛇᛉᛊᛏᛒᛖᛗᛘᛚᛜᛞᛟΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ∀∁∂∃∄∅∆∇∈∉∊∋∌∍∎∏∐∑−∓∔∕∖∗∘∙√∛∜∝∞⟁⟂⟃⟄⟅⟆⟇⟈⟉⟦⟧⟨⟩☤☥☧☨☩☫☬☯☰☱☲☳☴☵☶☷☸₿Ξ₳₲₵₭₮₯₰₱₴₸₹₺₼₽₾0123456789←↑→↓↔↕↖↗↘↙↚↛↜↝↞↟↠↡↢↣↤↥↦↧↨↩↪↫↬↭↮↯XYZNQRkmxzЖФШЩЪЫЭЮЯ');}
        _startAbsoluteEffects(){
            if(this._absoluteEffectsStarted)return;this._absoluteEffectsStarted=true;
            const mutate=()=>{const glyphs=this._absoluteGlyphs();document.querySelectorAll('.title-absolute-char').forEach(char=>{if(Math.random()>.38){char.textContent=glyphs[Math.floor(Math.random()*glyphs.length)];if(Math.random()>.6){char.classList.add('char-pop');setTimeout(()=>char.classList.remove('char-pop'),70);}}});};
            this._absoluteMutationTimer=setInterval(mutate,100);
            const overload=()=>{this._absoluteOverloadTimer=setTimeout(()=>{const titles=[...document.querySelectorAll('.title-absolute-container')];titles.forEach(title=>{title.classList.add('overload');const host=title.closest('.shop-title-row,.auth-profile-btn,.auth-warning-modal,.shop-confirm-modal,.leaderboard-row');host?.classList.add('absolute-host-shake');title.querySelectorAll('.title-absolute-char').forEach(char=>{char.textContent=this._absoluteGlyphs()[Math.floor(Math.random()*this._absoluteGlyphs().length)];char.style.transform=`scale(${Math.random()*1.5+.5}) translate(${Math.random()*30-15}px,${Math.random()*30-15}px)`;});});setTimeout(()=>{titles.forEach(title=>{title.classList.remove('overload');title.closest('.shop-title-row,.auth-profile-btn,.auth-warning-modal,.shop-confirm-modal,.leaderboard-row')?.classList.remove('absolute-host-shake');title.querySelectorAll('.title-absolute-char').forEach(char=>char.style.transform='');});overload();},350);},3000+Math.floor(Math.random()*5001));};
            overload();
        }
        fitTitleElements(scope = document) {
            const run=()=>{
                const elements=[...(scope.matches?.('.title-visual')?[scope]:[]),...scope.querySelectorAll('.title-visual')];
                elements.forEach(element=>{
                    element.style.fontSize='';
                    const container=element.parentElement,available=Math.max(1,(container?.clientWidth||0)-8);
                    if(!available)return;
                    const naturalSize=parseFloat(getComputedStyle(element).fontSize)||16,naturalWidth=element.scrollWidth;
                    if(naturalWidth>available)element.style.fontSize=`${Math.max(7,naturalSize*(available/naturalWidth)*.97).toFixed(2)}px`;
                });
            };
            requestAnimationFrame(run);
        }
        _dateKey(date = new Date()) {
            return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
        }
        _identity() {
            const signedIn=window.CubeAuth?.getCurrentUser?.()?.uid;
            if(signedIn)return signedIn;
            let device=AppStorage.getRaw('progressionDeviceId');
            if(!device){device=`guest_${Math.random().toString(36).slice(2)}`;AppStorage.setRaw('progressionDeviceId',device);}
            return device;
        }
        _allSolves() {
            const rows = [];
            Object.values(this.timer?.sessions || {}).forEach(session => (session.solves || []).forEach(s => rows.push({
                ...s, discipline: session.discipline || '3x3', effective: s.dnf ? Infinity : Number(s.time || 0) + Number(s.penalty || 0)
            })));
            return rows.filter(s => Number(s.timestamp) > 0).sort((a,b) => a.timestamp - b.timestamp);
        }
        _byDiscipline(solves = this._allSolves()) {
            const map = {};
            solves.forEach(s => (map[s.discipline] = map[s.discipline] || []).push(s));
            return map;
        }
        _average(window) {
            if (window.length < 3) return null;
            const dnfs = window.filter(s => s.dnf).length;
            if (dnfs >= 2) return null;
            const times = window.map(s => s.dnf ? Infinity : s.effective).sort((a,b)=>a-b).slice(1,-1);
            return times.some(x=>!Number.isFinite(x)) ? null : times.reduce((a,b)=>a+b,0)/times.length;
        }
        _rolling(solves, count) {
            const out=[];
            for(let i=count-1;i<solves.length;i++) out.push({ index:i, value:this._average(solves.slice(i-count+1,i+1)), solves:solves.slice(i-count+1,i+1) });
            return out.filter(x=>x.value!==null);
        }
        _bestAvg(solves,count) { const v=this._rolling(solves,count).map(x=>x.value); return v.length?Math.min(...v):null; }
        _metrics() {
            const solves=this._allSolves(), byDisc=this._byDiscipline(solves), valid=solves.filter(s=>Number.isFinite(s.effective));
            const dayCounts={}; solves.forEach(s=>dayCounts[this._dateKey(new Date(s.timestamp))]=(dayCounts[this._dateKey(new Date(s.timestamp))]||0)+1);
            const active=[...new Set([...Object.keys(dayCounts),...this.getFrozenDays()])].sort(); let streak=0,bestStreak=0,run=0,prev=null;
            active.forEach(k=>{const d=new Date(`${k}T12:00:00`);run=prev&&Math.round((d-prev)/DAY_MS)===1?run+1:1;bestStreak=Math.max(bestStreak,run);prev=d;});
            const streakDays=new Set(active);let cursor=new Date();cursor.setHours(12,0,0,0);if(!streakDays.has(this._dateKey(cursor)))cursor.setDate(cursor.getDate()-1);while(streakDays.has(this._dateKey(cursor))){streak++;cursor.setDate(cursor.getDate()-1);}
            const counts=Object.fromEntries(Object.entries(byDisc).map(([k,v])=>[k,v.length]));
            const disciplines=Object.keys(counts).sort((a,b)=>counts[b]-counts[a]);
            return { solves,byDisc,valid,total:solves.length,pb:valid.length?Math.min(...valid.map(s=>s.effective)):null,
                bestAo5:Math.min(...Object.values(byDisc).map(x=>this._bestAvg(x,5)).filter(x=>x!==null),Infinity),
                bestAo12:Math.min(...Object.values(byDisc).map(x=>this._bestAvg(x,12)).filter(x=>x!==null),Infinity),
                bestAo100:Math.min(...Object.values(byDisc).map(x=>this._bestAvg(x,100)).filter(x=>x!==null),Infinity),
                dayCounts,streak,bestStreak,counts,disciplines,mainDiscipline:disciplines[0]||null,secondaryDiscipline:disciplines[1]||null };
        }
        _snapshot(m=this._metrics()) {
            const currentSession=this.timer?.sessions?.[this.timer.currentSessionId], current=currentSession?.solves||[];
            const days=Object.values(m.dayCounts); const byDisc={};
            Object.entries(m.byDisc).forEach(([d,s])=>byDisc[d]={pb:Math.min(...s.filter(x=>Number.isFinite(x.effective)).map(x=>x.effective),Infinity),bestAo5:this._bestAvg(s,5),bestAo12:this._bestAvg(s,12),bestAo100:this._bestAvg(s,100)});
            return { createdAt:Date.now(),pb:m.pb,bestAo5:Number.isFinite(m.bestAo5)?m.bestAo5:null,bestAo12:Number.isFinite(m.bestAo12)?m.bestAo12:null,bestAo100:Number.isFinite(m.bestAo100)?m.bestAo100:null,
                currentAo5:this._bestAvg(current.map(s=>({...s,effective:s.dnf?Infinity:Number(s.time||0)+Number(s.penalty||0)})),5),
                ao12:this._bestAvg(current.map(s=>({...s,effective:s.dnf?Infinity:Number(s.time||0)+Number(s.penalty||0)})),12),
                ao100:this._bestAvg(current.map(s=>({...s,effective:s.dnf?Infinity:Number(s.time||0)+Number(s.penalty||0)})),100),
                dailyAverage:days.length?days.reduce((a,b)=>a+b,0)/days.length:0,yesterdayCount:m.dayCounts[this._dateKey(new Date(Date.now()-DAY_MS))]||0,
                mainDiscipline:m.mainDiscipline,secondaryDiscipline:m.secondaryDiscipline,disciplineCount:m.disciplines.length,byDisc };
        }
        _eligible(task,s) { return (task.requires||[]).every(r=>({pb:s.pb,ao12:s.ao12,ao100:s.ao100,bestAo5:s.bestAo5,bestAo100:s.bestAo100,dailyAverage:s.dailyAverage,yesterdayCount:s.yesterdayCount,mainDiscipline:s.mainDiscipline,secondaryDiscipline:s.secondaryDiscipline,currentAo5:s.currentAo5,threeDisciplines:s.disciplineCount>=3}[r] ?? false)); }
        _seeded(seed) { let h=2166136261;for(const c of seed){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return()=>((h=Math.imul(h^(h>>>15),1|h))>>>0)/4294967296; }
        ensureDaily() {
            const date=this._dateKey(),uid=this._identity(); if(this.state.daily?.date===date&&this.state.daily?.ownerId===uid)return;
            const snapshot=this._snapshot(), eligible=this.catalog.daily.filter(x=>this._eligible(x,snapshot));
            const rnd=this._seeded(`${uid}:${date}`), pool=[...eligible]; for(let i=pool.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
            this.state.daily={date,ownerId:uid,ids:pool.slice(0,3).map(x=>x.id),snapshot,completed:{},rewarded:{},bonusClaimed:false,firstSolveAt:null,openSessionStart:Date.now(),deletedCount:0,updatedAt:Date.now()};
            this._save();
        }
        _maybeUseStreakFreeze(todayKey) {
            if(this.inventory.freezes<1)return false;
            const today=this._dateFromKey(todayKey),yesterday=new Date(today);yesterday.setDate(yesterday.getDate()-1);
            const before=new Date(yesterday);before.setDate(before.getDate()-1);
            const yesterdayKey=this._dateKey(yesterday),beforeKey=this._dateKey(before),activity=this._metrics().dayCounts;
            const validFrozenDays=this.getFrozenDays();
            if(activity[yesterdayKey]||this.state.frozenDays?.[yesterdayKey]||(!activity[beforeKey]&&!validFrozenDays.has(beforeKey)))return false;
            this.state.frozenDays={...(this.state.frozenDays||{}),[yesterdayKey]:Date.now()};
            this._grantInventory(`freezeUsed:${yesterdayKey}`,'freezes',-1);
            this.state.events.freezeUsed=Date.now();
            this._toast(this._lang()==='ru'?'❄️ Заморозка автоматически спасла стрик':'❄️ A freeze automatically saved your streak');
            return true;
        }
        _reconcileInvalidFreezes() {
            const activity=this._metrics().dayCounts;
            let changed=false;
            Object.keys(this.state.frozenDays||{}).forEach(day=>{
                if(!activity[day]||this.state.freezeCancelledDays?.[day])return;
                this.state.freezeCancelledDays={...(this.state.freezeCancelledDays||{}),[day]:Date.now()};
                this._grantInventory(`freezeRefund:${day}`,'freezes',1);
                changed=true;
            });
            return changed;
        }
        _checkStreakFreezeAfterSync() {
            // Cloud history must be merged first. Otherwise a solve made on a
            // different device can look like a missed day and spend a freeze.
            let changed=this._reconcileInvalidFreezes();
            changed=this._maybeUseStreakFreeze(this._dateKey())||changed;
            if(changed)this._save();
        }
        _dateFromKey(key){const [y,m,d]=key.split('-').map(Number);return new Date(y,m-1,d);}

        init() {
            this.ensureDaily(); this.evaluate(true);
            window.addEventListener('timerdatachange',e=>{if(e.detail?.type==='delete'&&this.state.daily)this.state.daily.deletedCount++;this.scheduleEvaluation(e.detail?.type||'data');});
            window.addEventListener('progressionevent',e=>this.recordEvent(e.detail?.type));
            window.addEventListener('sync-status',e=>{if(e.detail?.state==='synced'&&window.CubeAuth?.getCurrentUser?.())this._checkStreakFreezeAfterSync();});
            window.addEventListener('resize',()=>{clearTimeout(this._titleResizeTimer);this._titleResizeTimer=setTimeout(()=>this.fitTitleElements(),80);});
            document.fonts?.ready?.then(()=>this.fitTitleElements());
            this._bindUI(); this.render(); this._startAbsoluteEffects(); this._scheduleMidnightReset();
        }
        _scheduleMidnightReset() {
            clearTimeout(this._midnightTimer);
            const next=new Date();next.setHours(24,0,0,100);
            this._midnightTimer=setTimeout(()=>{this.ensureDaily();this.evaluate(false);this._scheduleMidnightReset();},Math.max(1000,next-Date.now()));
        }
        scheduleEvaluation() { clearTimeout(this._timer);this._timer=setTimeout(()=>this.evaluate(false),80); }
        recordEvent(type) { if(!type)return;this.state.events[type]=Date.now();this.evaluate(false); }
        _claim(id,amount,label) { if(this.state.rewardLedger[id])return false;const awarded=this._rewardAmount(amount);this.state.rewardLedger[id]={amount:awarded,baseAmount:amount,multiplier:awarded/amount,at:Date.now()};this._toast(`+${awarded} 🪙 · ${label}`);return true; }
        _grantInventory(id,type,amount=1) { if(this.state.inventoryLedger[id])return false;this.state.inventoryLedger[id]={type,amount,at:Date.now()};return true; }
        purchaseItem(type) {
            const products={freezes:{price:1000},dnfInsurance:{price:600},coinBoosters:{price:800}},product=products[type];
            if(!product||this.coins<product.price){this._toast(this._lang()==='ru'?'Недостаточно монет':'Not enough coins');return false;}
            const id=`purchase:${type}:${Date.now()}:${Math.random().toString(36).slice(2,7)}`;
            this.state.rewardLedger[id]={amount:-product.price,at:Date.now(),kind:'purchase'};
            this._grantInventory(id,type,1);this.state.events.shopPurchase=Date.now();this._save();this.renderSkinsCatalog(this._lang()==='ru');this.scheduleEvaluation('shopPurchase');
            const names=this._lang()==='ru'?{freezes:'Заморозка куплена',dnfInsurance:'Страховка DNF куплена',coinBoosters:'Удвоитель монет куплен'}:{freezes:'Streak Freeze purchased',dnfInsurance:'DNF Insurance purchased',coinBoosters:'Coin Doubler purchased'};
            this._toast(names[type]||'✓','success');return true;
        }
        purchaseTitle(titleId) {
            const title=this.getTitle(titleId);if(!title)return false;
            if(this.state.ownedTitles?.[titleId])return this.equipTitle(titleId);
            if(this.coins<title.price){this._toast(this._lang()==='ru'?'Недостаточно монет':'Not enough coins');return false;}
            const ledgerId=`titlePurchase:${titleId}`;
            if(!this.state.rewardLedger[ledgerId])this.state.rewardLedger[ledgerId]={amount:-title.price,at:Date.now(),kind:'titlePurchase',titleId};
            this.state.ownedTitles={...(this.state.ownedTitles||{}),[titleId]:Date.now()};
            this.state.events.shopPurchase=Date.now();this._save();this.scheduleEvaluation('shopPurchase');
            this._toast(this._lang()==='ru'?`Титул «${title.name.ru}» куплен`:`Title “${title.name.en}” purchased`,'success');return true;
        }
        purchaseSkin(skinId){
            const skin=window.TIMER_SKIN_CATALOG?.skins.find(item=>item.id===skinId);if(!skin)return false;if(skin.multiPurchase)return this.purchaseLegendaryMetalSlot(skin);if(this.state.ownedSkins?.[skinId])return false;
            if(this.coins<skin.price){this._toast(this._lang()==='ru'?'Недостаточно монет':'Not enough coins');return false;}
            const ledgerId=`skinPurchase:${skinId}`;
            if(!this.state.rewardLedger[ledgerId])this.state.rewardLedger[ledgerId]={amount:-skin.price,at:Date.now(),kind:'skinPurchase',skinId};
            const purchasedAt=Date.now();this.state.ownedSkins={...(this.state.ownedSkins||{}),[skinId]:purchasedAt};
            if(skinId==='custom-gradient'&&!this.state.skinGradient)this.state.skinGradient=this._defaultState().skinGradient;
            this.state.events.shopPurchase=Date.now();this._save();this.renderSkinsCatalog(this._lang()==='ru');this.scheduleEvaluation('shopPurchase');
            this._toast(this._lang()==='ru'?`Скин «${skin.name.ru}» куплен. Нажмите «Использовать», чтобы применить.`:`“${skin.name.en}” purchased. Choose Use to apply it.`,'success');return true;
        }
        equipSkin(skinId){if(!this.state.ownedSkins?.[skinId])return false;const skin=window.TIMER_SKIN_CATALOG?.skins.find(item=>item.id===skinId);if(!skin||skin.multiPurchase)return false;this.state.equippedSkin=skinId;this.state.skinUpdatedAt=Date.now();this._save();this.renderSkinsCatalog(this._lang()==='ru');this._toast(this._lang()==='ru'?`Скин «${skin.name.ru}» используется`:`“${skin.name.en}” is now in use`,'success');return true;}
        purchaseLegendaryMetalSlot(skin=window.TIMER_SKIN_CATALOG?.skins.find(item=>item.id==='legendary-metal-fx')){if(!skin||this.coins<skin.price){this._toast(this._lang()==='ru'?'Недостаточно монет':'Not enough coins');return false;}const now=Date.now(),slotId=`metal-${now.toString(36)}-${Math.random().toString(36).slice(2,8)}`,slot={id:slotId,config:this._defaultMetalConfig(),configured:false,createdAt:now,updatedAt:now};this.state.rewardLedger[`skinPurchase:${skin.id}:${slotId}`]={amount:-skin.price,at:now,kind:'skinPurchase',skinId:skin.id,slotId};this.state.legendaryMetalSlots=[...(this.state.legendaryMetalSlots||[]),slot];this.state.ownedSkins={...(this.state.ownedSkins||{}),[skin.id]:this.state.ownedSkins?.[skin.id]||now};this.state.events.shopPurchase=now;this._save();this.renderSkinsCatalog(this._lang()==='ru');this.scheduleEvaluation('shopPurchase');this.openLegendaryMetal();this.configureLegendaryMetalSlot(slotId);return true;}
        equipTitle(titleId) {
            const title=this.getTitle(titleId);if(!title||!this.state.ownedTitles?.[titleId])return false;
            this.state.equippedTitle=titleId;this.state.titleUpdatedAt=Date.now();this._save();
            this._toast(this._lang()==='ru'?`Титул «${title.name.ru}» используется`:`Title “${title.name.en}” equipped`,'success');return true;
        }
        unequipTitle() {
            if(!this.state.equippedTitle)return false;
            this.state.equippedTitle=null;this.state.titleUpdatedAt=Date.now();this._save();
            this._toast(this._lang()==='ru'?'Титул снят':'Title unequipped','success');return true;
        }
        activateCoinBooster() {
            if(this.inventory.coinBoosters<1||this.isBoostActive())return false;
            const id=`boosterUsed:${Date.now()}`;this._grantInventory(id,'coinBoosters',-1);this.state.activeBoostUntil=Date.now()+86400000;this._toast(this._lang()==='ru'?'⚡ Удвоитель активирован на 24 часа':'⚡ Coin doubler active for 24 hours');this._save();return true;
        }
        useDnfInsurance() {
            if(this.inventory.dnfInsurance<1){this._toast(this._lang()==='ru'?'🛡️ Нужна страховка DNF из магазина':'🛡️ You need DNF insurance from the shop');return false;}
            this._grantInventory(`insuranceUsed:${Date.now()}:${Math.random().toString(36).slice(2,7)}`,'dnfInsurance',-1);this._toast(this._lang()==='ru'?'🛡️ Штраф исправлен — страховка использована':'🛡️ Penalty corrected — insurance used');this._save();return true;
        }

        _achievementDone(a,m) {
            const p=a.condition.split(':');
            if(p[0]==='total')return m.total>=+p[1]; if(p[0]==='single')return m.pb!==null&&m.pb<+p[1]; if(p[0]==='streak')return m.bestStreak>=+p[1];
            if(p[0]==='coins')return this.coins>=+p[1]; if(p[0]==='event')return !!this.state.events[p[1]]; if(p[0]==='disciplines')return m.disciplines.length>=+p[1];
            if(p[0]==='dayCount')return Math.max(0,...Object.values(m.dayCounts))>=+p[1];
            if(p[0]==='ao')return Object.values(m.byDisc).some(s=>s.length>=+p[1]);
            if(p[0]==='avg')return Object.values(m.byDisc).some(s=>this._bestAvg(s,+p[1])!==null&&this._bestAvg(s,+p[1])<+p[2]);
            if(p[0]==='aoDisciplines')return Object.values(m.byDisc).filter(s=>s.length>=+p[1]).length>=+p[2];
            if(p[0]==='cleanStreak'){let run=0,best=0;m.solves.forEach(s=>{run=(!s.dnf&&!s.penalty)?run+1:0;best=Math.max(best,run);});return best>=+p[1];}
            if(p[0]==='night')return m.solves.filter(s=>{const h=new Date(s.timestamp).getHours();return h>=+p[1]&&h<+p[2];}).length>=+p[3];
            if(p[0]==='equalPair')return m.solves.some((s,i)=>i&&Number.isFinite(s.effective)&&Math.round(s.effective*100)===Math.round(m.solves[i-1].effective*100));
            if(p[0]==='focus'){const n=+p[1],d=+p[2];for(let i=n-1;i<m.valid.length;i++){const w=m.valid.slice(i-n+1,i+1),avg=w.reduce((a,b)=>a+b.effective,0)/n;if(w.every(x=>Math.abs(x.effective-avg)<=d))return true;}return false;}
            return false;
        }
        evaluate(retro=false) {
            this.ensureDaily(); const m=this._metrics(); let changed=false;
            this.catalog.achievements.forEach(a=>{if(!this.state.unlocked[a.id]&&this._achievementDone(a,m)){this.state.unlocked[a.id]=Date.now();changed=this._claim(`achievement:${a.id}`,a.reward,this._text(a.name))||changed;}});
            const day=this.state.daily, today=m.solves.filter(s=>this._dateKey(new Date(s.timestamp))===day.date);
            if(today.length&&!day.firstSolveAt){day.firstSolveAt=today[0].timestamp;changed=true;}
            day.ids.forEach(id=>{const task=this.catalog.daily.find(x=>x.id===id);if(!task||day.completed[id])return;const result=this._dailyResult(id,today,day.snapshot,m,day);if(result.done){day.completed[id]=Date.now();changed=this._claim(`daily:${day.date}:${id}`,100,this._text(task.name))||changed;day.rewarded[id]=true;}});
            if(day.ids.length===3&&day.ids.every(id=>day.completed[id])&&!day.bonusClaimed){day.bonusClaimed=true;this._grantInventory(`dailyBonus:${day.date}`,'freezes',1);this._toast(this._lang()==='ru'?'❄️ Идеальный день: +1 заморозка':'❄️ Perfect day: +1 freeze');changed=true;}
            if(changed){day.updatedAt=Date.now();this._save();}else{AppStorage.setJSON(STORAGE_KEY,this.state);this.render();}
        }
        _dailyResult(id,s,b,m,d) {
            const clean=s.filter(x=>!x.dnf), finite=s.filter(x=>Number.isFinite(x.effective)), n=s.length, last=(k)=>s.slice(-k), countWhere=fn=>s.filter(fn).length;
            const rolling=(k)=>this._rolling(s,k), anyAvg=(k,fn)=>rolling(k).some(x=>fn(x.value,x.solves)), consecutive=(k,fn)=>{for(let i=k-1;i<s.length;i++)if(s.slice(i-k+1,i+1).every(fn))return true;return false;};
            const target=(current,total)=>({done:current>=total,current:Math.min(current,total),target:total}); let done=false,current=0,total=1;
            switch(id){
              case'd01':current=countWhere(x=>x.effective<b.pb+.5);total=3;break; case'd02':done=finite.some(x=>x.effective<b.pb-.009);break;
              case'd03':done=anyAvg(5,v=>v<b.ao12);break;case'd04':done=anyAvg(5,v=>v<b.bestAo5);break;case'd05':done=anyAvg(12,v=>v<b.ao100);break;case'd06':done=anyAvg(5,v=>v<b.ao100-1.5);break;case'd07':done=anyAvg(5,v=>v<b.bestAo5);break;
              case'd08':done=consecutive(5,x=>x.effective<b.ao100);break;case'd09':done=finite.some(x=>x.effective<b.pb+.2);break;case'd10':done=anyAvg(100,v=>v<b.bestAo100);break;
              case'd11':total=Math.ceil(b.dailyAverage*1.2);current=n;break;case'd12':current=n;total=300;break;case'd13':current=n;total=500;break;
              case'd14':done=s.some((x,i)=>i>=99&&x.timestamp-s[i-99].timestamp<=5400000);break;case'd15':current=d.firstSolveAt?countWhere(x=>x.timestamp<=d.firstSolveAt+1800000):0;total=50;break;
              case'd16':current=countWhere(x=>x.timestamp>=this.sessionStartedAt);total=100;break;case'd17':current=n;total=Math.max(1,b.yesterdayCount*2);break;
              case'd18':current=countWhere(x=>new Date(x.timestamp).getHours()>=18);total=150;break;case'd19':current=countWhere(x=>new Date(x.timestamp).getHours()<12);total=50;break;
              case'd20':current=Math.floor(finite.reduce((a,x)=>a+x.effective,0)/60);total=40;break;case'd21':done=anyAvg(5,(v,w)=>Math.max(...w.map(x=>x.effective))-Math.min(...w.map(x=>x.effective))<1.5);break;
              case'd22':done=consecutive(10,x=>Math.abs(x.effective-b.ao100)<=1);break;case'd23':done=anyAvg(12,(v,w)=>w.every(x=>!x.dnf&&!x.penalty));break;
              case'd24':done=consecutive(3,(x,i,w)=>i===0||Math.abs(x.effective-w[i-1].effective)<.3);break;case'd25':current=n&&!s.some(x=>x.dnf)?n:0;total=50;break;
              case'd26':done=rolling(5).some(x=>{const before=s[x.index-5],baseline=this._average(s.slice(0,x.index+1).slice(-12));return !!before&&x.solves[0].timestamp-before.timestamp>=10800000&&baseline!==null&&x.value<baseline;});break;
              case'd27':done=consecutive(20,x=>x.effective<b.ao100+2);break;case'd28':done=anyAvg(12,(v,w)=>Math.max(...w.map(x=>x.effective))-Math.min(...w.map(x=>x.effective))<1);break;
              case'd29':current=Math.max(0,n-(d.deletedCount||0));total=100;break;case'd30':{const recent=this._average(last(5)),first=this._average(s.slice(0,5));done=n>=10&&recent!==null&&first!==null&&recent<first;break;}
              case'd31':current=countWhere(x=>x.discipline===b.mainDiscipline);total=150;break;case'd32':current=countWhere(x=>x.discipline===b.secondaryDiscipline);total=50;break;
              case'd33':current=Object.values(this._byDiscipline(s)).filter(x=>x.length>=12).length;total=3;break;case'd34':done=s.some(x=>x.discipline!==b.mainDiscipline&&x.effective<(b.byDisc[x.discipline]?.pb??Infinity));break;
              case'd35':current=countWhere(x=>x.discipline==='2x2');total=100;break;case'd36':current=countWhere(x=>['4x4','5x5','6x6','7x7'].includes(x.discipline));total=20;break;
              case'd37':done=s.some((x,i)=>i>=74&&x.timestamp-s[i-74].timestamp<=3600000);break;case'd38':done=s.some((x,i)=>i>=9&&s.slice(i-9,i+1).every((y,j,w)=>j===0||y.timestamp-w[j-1].timestamp<=120000));break;
              case'd39':done=countWhere(x=>x.discipline==='3x3')>=25&&countWhere(x=>x.discipline==='2x2')>=25&&(countWhere(x=>x.discipline==='pyraminx')>=25||countWhere(x=>x.discipline==='4x4')>=25);break;
              case'd40':current=Math.floor(finite.filter(x=>['4x4','5x5'].includes(x.discipline)).reduce((a,x)=>a+x.effective,0)/60);total=30;break;
              case'd41':done=!!s[0]&&s[0].effective<b.ao100;break;case'd42':done=s.some((x,i)=>i&&s[i-1].penalty===2&&x.effective<b.currentAo5);break;
              case'd43':done=s.some((x,i)=>s[i-1]?.dnf&&s.slice(i,i+10).length===10&&s.slice(i,i+10).every(y=>!y.dnf&&!y.penalty&&y.effective<b.ao100));break;
              case'd44':current=rolling(5).filter(x=>x.value<b.ao12).length;total=3;break;case'd45':current=countWhere(x=>new Date(x.timestamp).getHours()<4);total=30;break;
              case'd46':current=countWhere(x=>{const h=new Date(x.timestamp).getHours();return h>=12&&h<15;});total=50;break;
              case'd47':done=s.some((x,i)=>i>=4&&s.slice(i-4,i+1).every((y,j,w)=>j===0||y.effective<w[j-1].effective));break;
              case'd48':done=rolling(100).some(x=>x.solves.filter(y=>y.dnf).length<=2);break;case'd49':done=finite.some(x=>Math.abs(x.effective-b.ao100)<=.05);break;
              case'd50':done=rolling(12).some(x=>{const dt=new Date(x.solves[11].timestamp);return dt.getHours()===23&&dt.getMinutes()>=50;});break;
            }
            if(total>1)return target(current,total);return{done,current:done?1:0,target:1};
        }

        _bindUI() {
            DOM('progressionClose')?.addEventListener('click',()=>DOM('progressionOverlay')?.classList.remove('visible'));
            DOM('progressionOverlay')?.addEventListener('click',e=>{if(e.target.id==='progressionOverlay')e.currentTarget.classList.remove('visible');});
            DOM('fireMenuAchievements')?.addEventListener('click',()=>this.open('achievements'));
            DOM('fireMenuShop')?.addEventListener('click',()=>this.openShop());
            DOM('shopClose')?.addEventListener('click',()=>DOM('shopOverlay')?.classList.remove('visible'));
            DOM('shopOverlay')?.addEventListener('click',e=>{if(e.target.id==='shopOverlay')e.currentTarget.classList.remove('visible');});
            DOM('shopItemsGrid')?.addEventListener('click',e=>{const buy=e.target.closest('[data-buy-item]'),use=e.target.closest('[data-use-item]');if(buy)this.requestPurchase(buy.dataset.buyItem);if(use?.dataset.useItem==='coinBoosters')this.activateCoinBooster();});
            DOM('shopSkinsTiers')?.addEventListener('click',e=>{const buy=e.target.closest('[data-buy-skin]'),use=e.target.closest('[data-use-skin]'),library=e.target.closest('[data-open-metal-library]');if(buy)this.requestSkinPurchase(buy.dataset.buySkin);if(use)this.equipSkin(use.dataset.useSkin);if(library)this.openLegendaryMetal();});
            DOM('metalFxBuyMore')?.addEventListener('click',()=>this.requestSkinPurchase('legendary-metal-fx'));
            DOM('metalFxClose')?.addEventListener('click',()=>this.closeLegendaryMetal());
            DOM('metalFxOverlay')?.addEventListener('click',e=>{if(e.target.id==='metalFxOverlay')this.closeLegendaryMetal();});
            DOM('metalFxBack')?.addEventListener('click',()=>{this.metalFxEditingSlotId=null;this.metalFxDraft=null;window.LegendaryMetalFx?.unmount();this._applyTimerSkin();this.openLegendaryMetal();});
            DOM('metalFxSave')?.addEventListener('click',()=>this.saveLegendaryMetalConfiguration());
            DOM('metalFxSlots')?.addEventListener('click',e=>{const use=e.target.closest('[data-equip-metal-slot]'),setup=e.target.closest('[data-configure-metal-slot]');if(use)this.equipLegendaryMetalSlot(use.dataset.equipMetalSlot);if(setup)this.configureLegendaryMetalSlot(setup.dataset.configureMetalSlot);});
            DOM('metalFxPresetSelect')?.addEventListener('change',e=>this._updateMetalFxDraft('presetName',e.target.value));
            DOM('metalFxSettings')?.addEventListener('input',e=>{const map={metalFxScale:'scale',metalFxComplexity:'complexity',metalFxContrast:'contrast',metalFxHue:'hue',metalFxSpeed:'speed'},key=map[e.target.id];if(key)this._updateMetalFxDraft(key,Number(e.target.value));});
            DOM('metalFxMode')?.addEventListener('click',()=>{if(this.metalFxDraft)this._updateMetalFxDraft('lightMode',!this.metalFxDraft.lightMode);});
            DOM('metalFxTweak')?.addEventListener('click',()=>{const panel=DOM('metalFxSettings');panel.classList.toggle('hidden');DOM('metalFxTweak').classList.toggle('active',!panel.classList.contains('hidden'));});
            DOM('metalFxPreview')?.addEventListener('click',()=>{if(!this.metalFxDraft)return;const list=this._metalPresets(),index=list.findIndex(p=>p.name===this.metalFxDraft.presetName);this._updateMetalFxDraft('presetName',list[(index+1)%list.length]?.name);});
            DOM('shopSkinsTiers')?.addEventListener('input',e=>{if(e.target.matches('[data-gradient-color],[data-gradient-direction]'))this._saveGradientFromControls();});
            DOM('shopSkinsTiers')?.addEventListener('pointermove',e=>{const preview=e.target.closest('.skin-holographic-demo,.skin-fluid-gradient-demo');if(preview)this._updateHolographicPointer(preview,e);});
            DOM('timerDisplay')?.addEventListener('pointermove',e=>{if(e.currentTarget.classList.contains('timer-skin-holographic')||e.currentTarget.classList.contains('timer-skin-fluid-gradient'))this._updateHolographicPointer(e.currentTarget,e);});
            document.querySelectorAll('[data-shop-section]').forEach(button=>button.addEventListener('click',()=>{this.shopSection=button.dataset.shopSection;this.renderShop();}));
            DOM('shopTitlesList')?.addEventListener('click',e=>{const buy=e.target.closest('[data-buy-title]'),equip=e.target.closest('[data-equip-title]');if(buy)this.requestTitlePurchase(buy.dataset.buyTitle);if(equip)this.equipTitle(equip.dataset.equipTitle);});
            DOM('shopTitleUnequip')?.addEventListener('click',()=>this.unequipTitle());
            DOM('shopConfirmCancel')?.addEventListener('click',()=>this.cancelPurchaseConfirmation());
            DOM('shopConfirmBuy')?.addEventListener('click',()=>this.confirmPurchase());
            DOM('shopConfirmOverlay')?.addEventListener('click',e=>{if(e.target.id==='shopConfirmOverlay')this.cancelPurchaseConfirmation();});
            document.querySelectorAll('[data-progression-tab]').forEach(b=>b.addEventListener('click',()=>this.open(b.dataset.progressionTab)));
        }
        requestPurchase(type){
            const products={freezes:{price:1000},dnfInsurance:{price:600},coinBoosters:{price:800}},product=products[type];if(!product)return;
            const ru=this._lang()==='ru',names=ru?{freezes:'Заморозка ударного режима',dnfInsurance:'Страховка от DNF',coinBoosters:'Удвоитель монет'}:{freezes:'Streak Freeze',dnfInsurance:'DNF Insurance',coinBoosters:'Coin Doubler'};
            this.pendingPurchaseType=type;
            this.pendingTitlePurchase=null;
            this.pendingSkinPurchase=null;
            const set=(id,value)=>{if(DOM(id))DOM(id).textContent=value};
            DOM('shopConfirmIcon').classList.remove('title-preview-mode');DOM('shopConfirmIcon').innerHTML=this._assetIcon(type,'shop-confirm-product-image');set('shopConfirmTitle',ru?'Подтвердить покупку':'Confirm purchase');
            set('shopConfirmText',ru?`Купить «${names[type]}» за ${product.price.toLocaleString('ru-RU')} монет?`:`Buy “${names[type]}” for ${product.price.toLocaleString('en-US')} coins?`);
            set('shopConfirmCancel',ru?'Отмена':'Cancel');set('shopConfirmBuy',ru?'Купить':'Buy');
            DOM('shopConfirmOverlay')?.classList.add('visible');
        }
        requestTitlePurchase(titleId){
            const title=this.getTitle(titleId);if(!title||this.state.ownedTitles?.[titleId])return;
            const ru=this._lang()==='ru';this.pendingTitlePurchase=titleId;this.pendingPurchaseType=null;this.pendingSkinPurchase=null;
            DOM('shopConfirmIcon').classList.add('title-preview-mode');DOM('shopConfirmIcon').innerHTML=this._titleMarkup(title,'shop-confirm-title-preview');
            DOM('shopConfirmTitle').textContent=ru?'Подтвердить покупку':'Confirm purchase';
            DOM('shopConfirmText').textContent=ru?`Купить титул «${title.name.ru}» за ${title.price.toLocaleString('ru-RU')} монет?`:`Buy the “${title.name.en}” title for ${title.price.toLocaleString('en-US')} coins?`;
            DOM('shopConfirmCancel').textContent=ru?'Отмена':'Cancel';DOM('shopConfirmBuy').textContent=ru?'Купить':'Buy';DOM('shopConfirmOverlay')?.classList.add('visible');this.fitTitleElements(DOM('shopConfirmIcon'));
        }
        requestSkinPurchase(skinId){
            const skin=window.TIMER_SKIN_CATALOG?.skins.find(item=>item.id===skinId);if(!skin||(!skin.multiPurchase&&this.state.ownedSkins?.[skinId]))return;
            if(this.coins<skin.price){this._toast(this._lang()==='ru'?'Недостаточно монет':'Not enough coins');return;}
            const ru=this._lang()==='ru';this.pendingSkinPurchase=skinId;this.pendingTitlePurchase=null;this.pendingPurchaseType=null;
            DOM('shopConfirmIcon').classList.remove('title-preview-mode');DOM('shopConfirmIcon').textContent='🎨';
            DOM('shopConfirmTitle').textContent=ru?'Подтвердить покупку':'Confirm purchase';
            DOM('shopConfirmText').textContent=skin.multiPurchase?(ru?`Купить отдельную настраиваемую ячейку за ${skin.price.toLocaleString('ru-RU')} монет? Каждый повторный заказ создаёт новый слот.`:`Buy one separately configurable slot for ${skin.price.toLocaleString('en-US')} coins? Each purchase creates a new slot.`):(ru?`Купить скин «${skin.name.ru}» за ${skin.price.toLocaleString('ru-RU')} монет?`:`Buy the “${skin.name.en}” skin for ${skin.price.toLocaleString('en-US')} coins?`);
            DOM('shopConfirmCancel').textContent=ru?'Отмена':'Cancel';DOM('shopConfirmBuy').textContent=ru?'Купить':'Buy';DOM('shopConfirmOverlay')?.classList.add('visible');
        }
        cancelPurchaseConfirmation(){this.pendingPurchaseType=null;this.pendingTitlePurchase=null;this.pendingSkinPurchase=null;DOM('shopConfirmOverlay')?.classList.remove('visible');}
        confirmPurchase(){const type=this.pendingPurchaseType,titleId=this.pendingTitlePurchase,skinId=this.pendingSkinPurchase;this.cancelPurchaseConfirmation();if(type)this.purchaseItem(type);else if(titleId)this.purchaseTitle(titleId);else if(skinId)this.purchaseSkin(skinId);}
        _requireAuth(feature){
            if(window.CubeAuth?.getCurrentUser?.()?.uid||AppStorage.getJSON('authUser')?.uid)return true;
            const ru=this._lang()==='ru',isShop=feature==='shop';
            DOM('authWarningTitle').textContent=ru?'Требуется вход':'Sign in required';
            DOM('authWarningText').textContent=ru?`${isShop?'Магазин':'Достижения и задачи дня'} доступны только после входа в аккаунт. Войдите, чтобы продолжить и синхронизировать прогресс между устройствами.`:`${isShop?'The shop':'Achievements and daily tasks'} are available only when signed in. Sign in to continue and sync your progress across devices.`;
            DOM('authWarningCloseBtn').textContent=ru?'Закрыть':'Close';DOM('authWarningLoginBtn').textContent=ru?'Войти':'Log in';
            DOM('authWarningOverlay')?.classList.add('visible');return false;
        }
        open(tab='achievements') { if(!this._requireAuth('progression'))return;this.ensureDaily();this.activeTab=tab;DOM('progressionOverlay')?.classList.add('visible');this.render(); }
        openShop(){if(!this._requireAuth('shop'))return;this.ensureDaily();this.shopSection='skins';DOM('shopOverlay')?.classList.add('visible');this.renderShop();}
        renderShop(){
            const root=DOM('shopOverlay');if(!root)return;const ru=this._lang()==='ru',inv=this.inventory;
            const text=ru?{title:'Магазин',skins:'Скины',effects:'Эффекты',items:'Предметы',titles:'Титулы',soon:'Скоро',owned:'В инвентаре',buy:'Купить',use:'Активировать',active:'Удвоитель активен до',freeze:['Заморозка ударного режима','Автоматически спасает стрик, если пропущен один день. Замороженный день становится синим и не засчитывается в идеальную неделю.'],insurance:['Страховка от DNF','Одноразово позволяет исправить DNF или +2. Сгорает сразу после исправления штрафа.'],booster:['Удвоитель монет','После активации удваивает награды за достижения и задания дня в течение 24 часов.']}:{title:'Shop',skins:'Skins',effects:'Effects',items:'Items',titles:'Titles',soon:'Soon',owned:'In inventory',buy:'Buy',use:'Activate',active:'Coin doubler active until',freeze:['Streak Freeze','Automatically saves your streak after one missed day. The frozen day is blue and prevents a perfect week.'],insurance:['DNF Insurance','Lets you correct one DNF or +2. Consumed immediately when the penalty is corrected.'],booster:['Coin Doubler','After activation, doubles achievement and daily-task rewards for 24 hours.']};
            const set=(id,v)=>{if(DOM(id))DOM(id).textContent=v};set('shopTitle',text.title);set('shopSkinsTab',text.skins);set('shopEffectsTab',text.effects);set('shopItemsTab',text.items);set('shopTitlesTab',text.titles);set('shopItemsTitle',text.items);set('shopTitlesTitle',text.titles);set('shopEffectsSoon',text.soon);
            this.renderSkinsCatalog(ru);
            const section=this.shopSection||'items';
            document.querySelectorAll('[data-shop-section]').forEach(button=>button.classList.toggle('active',button.dataset.shopSection===section));
            DOM('shop-section-skins')?.classList.toggle('active',section==='skins');DOM('shop-section-items')?.classList.toggle('active',section==='items');DOM('shop-section-titles')?.classList.toggle('active',section==='titles');
            set('shopCoins',this.coins);set('shopFreezes',inv.freezes);set('shopBoosters',inv.coinBoosters);set('shopInsurance',inv.dnfInsurance);
            const boost=DOM('shopActiveBoost');boost?.classList.toggle('hidden',!this.isBoostActive());if(boost&&this.isBoostActive())boost.innerHTML=`${this._assetIcon('coinBoosters')}<span>${text.active} ${new Intl.DateTimeFormat(ru?'ru-RU':'en-US',{dateStyle:'short',timeStyle:'short'}).format(new Date(this.state.activeBoostUntil))}</span>`;
            const cards=[['freezes',text.freeze,1000,inv.freezes],['dnfInsurance',text.insurance,600,inv.dnfInsurance],['coinBoosters',text.booster,800,inv.coinBoosters]];
            DOM('shopItemsGrid').innerHTML=cards.map(([type,copy,price,owned])=>`<article class="shop-item-card"><div class="shop-item-icon">${this._assetIcon(type,'shop-product-image')}</div><h4>${copy[0]}</h4><p>${copy[1]}</p><div class="shop-item-owned">${text.owned}: ${owned}</div><div class="shop-item-actions"><button class="shop-buy-btn" data-buy-item="${type}" ${this.coins<price?'disabled':''}>${text.buy} · ${price} ${this._assetIcon('coins','inline-economy-icon')}</button>${type==='coinBoosters'?`<button class="shop-use-btn" data-use-item="${type}" ${owned<1||this.isBoostActive()?'disabled':''}>${text.use}</button>`:''}</div></article>`).join('');
            this.renderTitlesShop();
        }
        renderSkinsCatalog(ru=this._lang()==='ru'){
            const catalog=window.TIMER_SKIN_CATALOG,host=DOM('shopSkinsTiers');if(!catalog||!host)return;
            const fmt=value=>Number(value).toLocaleString(ru?'ru-RU':'en-US');
            const timerDisplay=DOM('timerDisplay'),timerFont=timerDisplay?getComputedStyle(timerDisplay).fontFamily:'Manrope, sans-serif';
            host.style.setProperty('--timer-skin-font-family',timerFont);
            DOM('shopSkinsTitle').textContent=ru?'Скины таймера':'Timer Skins';
            DOM('shopSkinsIntro').textContent=ru?'Все скины можно купить. После покупки выберите «Использовать». Настройку легендарной ячейки можно сохранить только один раз.':'All skins are available to buy. Choose Use after purchase. Legendary slots can only be configured once.';
            const equipped=this.state.ownedSkins?.[this.state.equippedSkin]?this.state.equippedSkin:null;
            host.innerHTML=catalog.tiers.map(tier=>{
                const items=catalog.skins.filter(skin=>skin.tier===tier.id);
                const cards=items.length?items.map(skin=>{
                    const id=skin.id,isGlow=id==='spectrum-glow',isCorgo=id==='corgo-bounce',isHolo=id==='holographic-foil',isNeon=id==='neon-sign',isBlazing=id==='blazing-glow',isCyanPulse=id==='soft-cyan-pulse',isShimmering=id==='shimmering-neon',isFluid=id==='fluid-gradient',isMetal=id==='legendary-metal-fx',isFire=skin.assetType==='animated-svg',isTexture=!!skin.asset&&!isFire,isFlowing=id==='flowing-gradient',isCustom=id==='custom-gradient';
                    const owned=!!this.state.ownedSkins?.[id],isActive=equipped===id,metalCount=(this.state.legendaryMetalSlots||[]).length,gradient=this._normalizedGradient(),gradientCss=`linear-gradient(${gradient.direction}deg, ${gradient.colors.join(', ')})`;
                    const filter=isGlow?`<svg class="shop-skin-filter" width="0" height="0" aria-hidden="true"><filter id="skin-glow-${id}" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blurred"/><feBlend in="SourceGraphic" in2="blurred" result="glow"/><feColorMatrix in="glow" type="saturate" values="1.3" result="saturated"/><feBlend in="SourceGraphic" in2="saturated"/></filter></svg>`:'';
                    const makeChars=(value,kind)=>Array.from(value,(char,index)=>{const cls=kind==='corgo'?'skin-corgo-char':kind==='neon'?'skin-neon-char':kind==='shimmer'?'skin-shimmer-char':'';return `<span class="${cls}" data-char="${this._escapeHtml(char)}" style="--char-index:${index}">${char===' '?'&nbsp;':this._escapeHtml(char)}</span>`;}).join('');
                    const previewClass=isGlow?'skin-spectrum-glow':isBlazing?'skin-blazing-demo':isCyanPulse?'skin-cyan-pulse-demo':id==='linear-shine'?'skin-shine-demo':'skin-neon-demo';
                    const digitPreview=isMetal?`<span class="shop-skin-preview-demo metal-fx-catalog-preview">12.34</span>`:
                        isFluid?`<div class="fluid-text-hover-preview"><span class="fluid-hover-mask-text">12.34</span></div>`:
                        isFire?`<span class="shop-skin-preview-demo skin-fire-fill-demo" style="--timer-skin-image:url('${skin.asset}')">12.34</span>`:
                        isTexture?`<span class="shop-skin-preview-demo skin-image-texture-demo" style="--timer-skin-image:url('${skin.asset}')">12.34</span>`:
                        isCustom?`<span class="shop-skin-preview-demo skin-custom-gradient" style="--custom-timer-gradient:${gradientCss}">12.34</span>`:
                        isFlowing?`<svg class="shop-skin-flow-svg" viewBox="0 0 160 52" role="img" aria-label="12.34"><defs><linearGradient id="skin-gradient-${id}" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#33235b"/><stop offset="25%" stop-color="#D62229"/><stop offset="50%" stop-color="#E97639"/><stop offset="75%" stop-color="#792042"/><stop offset="100%" stop-color="#33235b"/></linearGradient><pattern id="skin-pattern-${id}" x="0" y="0" width="320" height="52" patternUnits="userSpaceOnUse"><rect x="0" y="0" width="160" height="52" fill="url(#skin-gradient-${id})"><animate attributeType="XML" attributeName="x" from="0" to="150%" dur="7s" repeatCount="indefinite"/></rect><rect x="-160" y="0" width="160" height="52" fill="url(#skin-gradient-${id})"><animate attributeType="XML" attributeName="x" from="-150%" to="0" dur="7s" repeatCount="indefinite"/></rect></pattern></defs><text x="50%" text-anchor="middle" y="50%" dy="0.4em" fill="url(#skin-pattern-${id})" font-size="42" font-weight="700">12.34</text></svg>`:
                        isCorgo?`<span class="skin-corgo-demo" aria-label="12.34">${makeChars('12.34','corgo')}</span>`:
                        isNeon?`<span class="shop-skin-preview-demo skin-neon-sign-demo">${makeChars('12.34','neon')}</span>`:
                        isShimmering?`<span class="shop-skin-preview-demo text-effect-wrapper"><span class="skin-shimmer-text" data-text="12.34">12.34</span></span>`:
                        isHolo?`<span class="shop-skin-preview-demo skin-holographic-demo" data-holo-label="12.34">12.34</span>`:
                        `<span class="shop-skin-preview-demo ${previewClass}" ${isGlow?`style="filter:url(#skin-glow-${id})"`:''}>12.34</span>`;
                    let action;
                    if(isMetal){
                        action=`<div class="shop-skin-actions"><button class="shop-skin-action buy" data-buy-skin="${id}" ${this.coins<skin.price?'disabled':''}>${ru?'Купить ячейку':'Buy slot'} · ${fmt(skin.price)} ${this._assetIcon('coins','inline-economy-icon')}</button>${metalCount?`<button class="metal-fx-owned-button" data-open-metal-library>${ru?'Куплено':'Purchased'} · ${metalCount}</button>`:''}</div>`;
                    }else if(owned){
                        action=`<button class="shop-skin-action use${isActive?' equipped':''}" data-use-skin="${id}" ${isActive?'disabled':''}>${isActive?(ru?'Используется':'In use'):(ru?'Использовать':'Use')}</button>`;
                    }else{
                        action=`<button class="shop-skin-action buy" data-buy-skin="${id}" ${this.coins<skin.price?'disabled':''}>${ru?'Купить':'Buy'} · ${fmt(skin.price)} ${this._assetIcon('coins','inline-economy-icon')}</button>`;
                    }
                    const editor=isCustom&&owned?`<div class="shop-gradient-editor"><label>${ru?'Цвет 1':'Color 1'}<input type="color" data-gradient-color value="${gradient.colors[0]}"></label><label>${ru?'Цвет 2':'Color 2'}<input type="color" data-gradient-color value="${gradient.colors[1]}"></label><label>${ru?'Цвет 3':'Color 3'}<input type="color" data-gradient-color value="${gradient.colors[2]}"></label><label class="shop-gradient-direction">${ru?'Направление':'Direction'}<span><input type="range" min="0" max="360" step="1" data-gradient-direction value="${gradient.direction}"><output data-gradient-angle>${gradient.direction}°</output></span></label><p>${ru?'Настройки сохраняются автоматически. Меняйте их бесплатно в любое время.':'Settings save automatically. Change them for free at any time.'}</p></div>`:'';
                    return `<article class="shop-skin-card"><div class="shop-skin-preview">${filter}${digitPreview}</div><div class="shop-skin-copy"><h4>${this._text(skin.name)}</h4><p>${this._text(skin.description)}</p><span class="shop-skin-price">${fmt(skin.price)} ${ru?'монет':'coins'}</span></div>${action}${editor}</article>`;
                }).join(''):`<p class="shop-skin-empty">${ru?'Скинов этого уровня пока нет':'No skins in this tier yet'}</p>`;
                return `<section class="shop-skin-tier" data-skin-tier="${tier.id}"><div class="shop-skin-tier-heading"><h4>${tier.order}. ${this._text(tier.name)}</h4><span>${fmt(tier.minPrice)}–${fmt(tier.maxPrice)} ${ru?'монет':'coins'}</span></div>${cards}</section>`;
            }).join('');
            host.querySelectorAll('.fluid-text-hover-preview').forEach(fluidHost=>{
                const text=fluidHost.querySelector('.fluid-hover-mask-text');
                const ready=window.FluidTextHover?.mount(fluidHost,text);
                fluidHost.classList.toggle('fluid-text-hover-fallback',!ready);
            });
        }
        renderTitlesShop(){
            const list=DOM('shopTitlesList');if(!list)return;const ru=this._lang()==='ru',owned=this.state.ownedTitles||{},equipped=this.state.equippedTitle;
            const copy=ru?{buy:'Купить',use:'Использовать',using:'Используется',unequip:'Снять титул'}:{buy:'Buy',use:'Equip',using:'Equipped',unequip:'Unequip title'};
            DOM('shopTitleUnequip').textContent=copy.unequip;DOM('shopTitleUnequip').classList.toggle('hidden',!equipped);
            const tiers=Object.entries(this.titleCatalog.tiers).sort((a,b)=>a[1].order-b[1].order);
            list.innerHTML=tiers.map(([tier,tierData])=>{
                const rows=this.titleCatalog.titles.filter(title=>title.tier===tier).map(title=>{
                    const isOwned=!!owned[title.id],isEquipped=equipped===title.id;
                    const action=isOwned?`<button class="shop-title-action ${isEquipped?'equipped':''}" data-equip-title="${title.id}" ${isEquipped?'disabled':''}>${isEquipped?copy.using:copy.use}</button>`:`<button class="shop-title-action buy" data-buy-title="${title.id}" ${this.coins<title.price?'disabled':''}>${copy.buy} · ${title.price.toLocaleString(ru?'ru-RU':'en-US')} ${this._assetIcon('coins','inline-economy-icon')}</button>`;
                    return `<article class="shop-title-row tier-${tier}"><div class="shop-title-preview">${this._titleMarkup(title)}</div>${action}</article>`;
                }).join('');
                return `<section class="shop-title-tier"><h4>${tierData.order}. ${this._text(tierData.name)}</h4>${rows}</section>`;
            }).join('');
            this.fitTitleElements(list);
        }
        render() {
            const root=DOM('progressionOverlay');if(!root)return;const lang=this._lang(),inv=this.inventory;
            const labels=lang==='ru'?{title:'Прогресс',ach:'Достижения',daily:'Задачи дня',coins:'Монеты',freeze:'Заморозки',boost:'Бустеры x2',dnf:'Страховки DNF',locked:'Не выполнено',done:'Получено',perfect:'Выполните все 3 задания и получите заморозку'}:{title:'Progress',ach:'Achievements',daily:'Daily Tasks',coins:'Coins',freeze:'Freezes',boost:'x2 Boosters',dnf:'DNF Insurance',locked:'Locked',done:'Claimed',perfect:'Complete all 3 tasks to earn a freeze'};
            DOM('progressionTitle').textContent=labels.title;DOM('progressionAchievementsTab').textContent=labels.ach;DOM('progressionDailyTab').textContent=labels.daily;
            DOM('progressionCoins').textContent=this.coins;DOM('progressionFreezes').textContent=inv.freezes;DOM('progressionBoosters').textContent=inv.coinBoosters;DOM('progressionDnfInsurance').textContent=inv.dnfInsurance;
            root.querySelectorAll('.progression-wallet small').forEach((el,i)=>el.textContent=[labels.coins,labels.freeze,labels.boost,labels.dnf][i]);
            document.querySelectorAll('[data-progression-tab]').forEach(b=>b.classList.toggle('active',b.dataset.progressionTab===(this.activeTab||'achievements')));
            const achPanel=DOM('progressionAchievements'),dayPanel=DOM('progressionDaily');achPanel.classList.toggle('hidden',(this.activeTab||'achievements')!=='achievements');dayPanel.classList.toggle('hidden',this.activeTab!=='daily');
            achPanel.innerHTML=this.catalog.achievements.map(a=>{const unlocked=!!this.state.unlocked[a.id];return`<article class="achievement-card ${unlocked?'unlocked':''}"><div class="achievement-icon">${unlocked?'🏆':'🔒'}</div><div class="achievement-copy"><h3>${this._text(a.name)}</h3><p>${this._text(a.description)}</p><span>${unlocked?labels.done:labels.locked}</span></div><strong>+${a.reward} ${this._assetIcon('coins','inline-economy-icon')}</strong></article>`;}).join('');
            const m=this._metrics(),today=m.solves.filter(s=>this._dateKey(new Date(s.timestamp))===this.state.daily.date);
            dayPanel.innerHTML=`<p class="daily-perfect-hint">${this._assetIcon('freezes')}<span>${labels.perfect}</span></p>`+this.state.daily.ids.map(id=>{const a=this.catalog.daily.find(x=>x.id===id),r=this._dailyResult(id,today,this.state.daily.snapshot,m,this.state.daily),done=!!this.state.daily.completed[id],pct=Math.min(100,Math.round(r.current/r.target*100));return`<article class="daily-task-card ${done?'completed':''}"><div><span>${done?'✓':'◆'}</span><h3>${this._text(a.name)}</h3><p>${this._text(a.description)}</p></div><strong>+100 ${this._assetIcon('coins','inline-economy-icon')}</strong><div class="daily-task-progress"><i style="width:${pct}%"></i></div><small>${r.current} / ${r.target}</small></article>`;}).join('');
            if(DOM('shopOverlay')?.classList.contains('visible'))this.renderShop();
        }
        _toast(text,kind='info') {
            let el=DOM('progressionToast');
            if(!el){el=document.createElement('div');el.id='progressionToast';el.className='progression-toast';el.innerHTML='<span class="progression-toast-icon"></span><span class="progression-toast-copy"><strong>Next Cube Pro</strong><span></span></span>';document.body.appendChild(el);}
            const assetType=/❄️/.test(text)?'freezes':/🛡️/.test(text)?'dnfInsurance':/⚡/.test(text)?'coinBoosters':/🪙/.test(text)?'coins':null;
            const icons={success:'✓',info:'✨'};el.dataset.kind=kind;el.querySelector('.progression-toast-icon').innerHTML=assetType?this._assetIcon(assetType,'toast-economy-icon'):icons[kind]||icons.info;el.querySelector('.progression-toast-copy span').textContent=text.replace(/(?:❄️|🛡️|⚡|🪙)\s*/g,'');
            el.classList.remove('visible');void el.offsetWidth;el.classList.add('visible');clearTimeout(this._toastTimer);this._toastTimer=setTimeout(()=>el.classList.remove('visible'),3800);
        }
    }
    window.ProgressionSystem=ProgressionSystem;
})();
