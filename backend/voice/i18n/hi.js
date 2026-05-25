export const hiVoiceTexts = {
  'language.select':
    'नमस्ते, Tatva पर आपका स्वागत है — मैं प्रांशु। कौन सी भाषा सही लगे? English, Hinglish, Hindi, Kannada, या Telugu — बोलिए।',
  'language.unknown':
    'माफ़ कीजिए, समझ नहीं आया। English, Hinglish, Hindi, Kannada, या Telugu बोलिए।',
  'language.changed':
    'धन्यवाद, आपने {languageName} चुनी है। बताइए, मैं आपकी कैसे मदद कर सकता हूँ?',
  'language.changed.hinglish':
    'धन्यवाद, आपने Hinglish चुनी है। बताइए, मैं आपकी कैसे मदद कर सकता हूँ?',
  'greeting.hinglish':
    'नमस्ते, प्रांशु — Tatva पर। Cart se continue karein, ya naye product se shuru karein?',

  'flow.stepPrefix': 'चरण {n}, {label}. ',
  'flow.stepLabel.search': 'उत्पाद खोज',
  'flow.stepLabel.quantity': 'मात्रा',
  'flow.stepLabel.cart': 'कार्ट',
  'flow.stepLabel.suppliers': 'आपूर्तिकर्ता चयन',
  'flow.stepLabel.substitution': 'प्रतिस्थापन',
  'flow.stepLabel.po_details': 'खरीद ऑर्डर विवरण',
  'flow.stepLabel.transport': 'परिवहन चयन',
  'flow.stepLabel.confirm_order': 'ऑर्डर पुष्टि',
  'flow.stepLabel.done': 'पूर्ण',
  'search.productLine': '{index}. {name}',
  'cart.itemsCountOne': '1 आइटम',
  'cart.itemsCountMany': '{count} आइटम',
  'supplier.fallbackName': 'आपूर्तिकर्ता',
  'sub.defaultTitle': 'सुझाव',
  'confirm.groupLine': 'ऑर्डर {index}, {vendor}, {total} रुपये',
  'confirm.transportPart': ' परिवहन: {transportSummary}।',

  'confirm.pendingDefault': 'यह कार्रवाई पूरी करें',
  'confirm.pendingPoDetails': 'खरीद ऑर्डर विवरण',

  'search.single':
    'बढ़िया — {productName} मिल गया। कार्ट में जोड़ें? कार्ट में जोड़ो बोलिए, या नंबर एक।',
  'search.multiple':
    'मैंने {total} विकल्प निकाले। {lines}. कौन सा पसंद है — नंबर या नाम बोलिए।',
  'search.notFound.withQuery':
    '"{query}" का exact मैच अभी नहीं — कोई बात नहीं। नाम फिर बोलिए, या छोटा नाम जैसे सीमेंट, स्टील रॉड।',
  'search.notFound.noQuery':
    'अभी नहीं मिला — बताइए क्या चाहिए: सीमेंट, Mac Air M2, जो भी खरीद रहे हैं।',
  'search.fuzzy':
    'मैंने "{query}" सुना। सबसे करीब {total} मैच: {lines}. प्रोडक्ट नंबर या नाम बोलिए।',
  'search.askQuantity': 'अच्छा चुनाव। {productName} कितने जोड़ूँ? बस संख्या बोलिए।',
  'search.pickProduct': 'कौन सा चाहिए? {choices}. नंबर या नाम — आपकी मर्ज़ी।',
  'ui.heardYouSay': 'मैंने सुना:',
  'stt.didNotCatch':
    'शायद मैंने सही नहीं सुना। दोबारा साफ़ बोलिए — प्रोडक्ट का नाम, मात्रा, या कार्ट में जोड़ो।',
  'search.requestTimeout': 'खोज में थोड़ा समय लगा। छोटा प्रोडक्ट नाम आज़माइए।',
  'search.serviceUnavailable': 'अभी खोज नहीं हो पाई। थोड़ी देर बाद फिर कोशिश करिए।',

  'cart.added': '{productName} अब आपके कार्ट में है।',
  'cart.qtyIncreased': '{productName} की मात्रा कार्ट में बढ़ा दी।',
  'cart.continue': 'कार्ट स्क्रीन पर है — तैयार हों तो जारी रखिए या सप्लायर बताइए।',
  'cart.discoveryHandoff':
    'स्क्रीन पर नज़र डालिए — ठीक लगे तो जारी रखिए, या सप्लायर बता दीजिए।',
  'cart.withItems.cart':
    'आपके कार्ट में {items} हैं। जारी रखिए बोलिए, या सप्लायर चुनिए।',
  'cart.withItems.discovery':
    'आपके कार्ट में {items} हैं। जारी रखिए, सप्लायर चुनिए, या नया प्रोडक्ट खोजिए।',
  'cart.checkoutOnly':
    'चेकआउट कार्ट से चल रहा है। जारी रखिए या सप्लायर चुनिए। नया प्रोडक्ट चाहिए तो प्रोडक्ट खोज बोलिए।',
  'cart.empty':
    'आपका कार्ट खाली है। प्रोडक्ट का नाम बोलिए, या प्रोडक्ट खोज बोलिए।',
  'cart.checkoutCancelled':
    'ठीक है, चेकआउट रद्द कर दिया। चाहिए तो दूसरा प्रोडक्ट खोज सकते हैं।',
  'cart.addFailed': '{productName} कार्ट में जोड़ नहीं हो सका।',
  'cart.needSearchBeforeAdd': 'पहले प्रोडक्ट खोजिए, फिर कार्ट में जोड़ने के लिए बोलिए।',
  'cart.searchProductNameFirst':
    'कदम एक, खोज। पहले प्रोडक्ट का नाम बोलिए, जैसे Mac Air M2.',

  'nav.productDiscovery':
    'आप प्रोडक्ट खोज पर हैं। प्रोडक्ट का नाम बोलिए, मैं खोजूँगा।',
  'nav.orders': 'आपके ऑर्डर खोल रहा हूँ। पुराने ऑर्डर स्क्रीन पर दिखेंगे।',
  'nav.generic': '{label} खोल रहा हूँ। अब आगे क्या करना है, बोलिए।',
  'nav.screen.cart': 'कार्ट',
  'nav.screen.supplier_select': 'सप्लायर चयन',
  'nav.screen.substitution': 'विकल्प',
  'nav.screen.create_po': 'खरीद ऑर्डर',
  'nav.screen.transport': 'ट्रांसपोर्ट',
  'nav.resumeCheckout': 'ठीक है, कार्ट से चेकआउट जारी रखते हैं।',

  'help.cartMode':
    'कार्ट चेकआउट मोड में हैं। कार्ट देखिए, फिर जारी रखिए बोलिए — मैं सप्लायर से ऑर्डर पुष्टि तक ले जाऊँगा।',
  'help.discoveryMode':
    'साथ में प्रोडक्ट ढूँढ रहे हैं — नाम, सूची, मात्रा, फिर कार्ट। अटकें तो मदद। चेकआउट के लिए मेरा कार्ट बोलिए।',
  'help.await_add_quantity': 'कितनी मात्रा चाहिए बोलिए — जैसे 2, दो, या दो नंबर।',
  'help.await_pick_product':
    'सूची से प्रोडक्ट नंबर बोलिए, या कार्ट में जोड़ने के लिए बोलिए।',
  'help.await_discovery_cart_handoff':
    'कार्ट में जोड़ दिया। स्क्रीन देखिए, फिर जारी रखिए या सप्लायर चुनिए।',
  'help.await_cart_continue':
    'कार्ट स्क्रीन पर देखिए। तैयार हों तो जारी रखिए या सप्लायर चुनिए बोलिए।',
  'help.await_select_supplier': 'सप्लायर नंबर एक बोलिए, या सप्लायर का नाम बोलिए।',
  'help.await_substitution':
    'छोड़ने के लिए विकल्प नहीं बोलिए, सुझाव स्वीकार के लिए हाँ बोलिए।',
  'help.await_po_requiredDate': 'डिलीवरी तारीख बोलिए, जैसे 20 मई 2026, या डिफ़ॉल्ट बोलिए।',
  'help.await_po_payment': 'कैश ऑन डिलीवरी, ऑनलाइन, या बैंक ट्रांसफर बोलिए।',
  'help.await_po_addresses': 'शिपिंग पता पुष्टि के लिए हाँ बोलिए।',
  'help.await_po_generic': 'ऑर्डर के बारे में जो सवाल पूछा था, उसका जवाब दीजिए।',
  'help.await_place_confirm': 'खरीद के लिए ऑर्डर प्लेस बोलिए, रद्द के लिए नहीं बोलिए।',
  'help.await_transport':
    'ट्रांसपोर्ट नंबर एक बोलिए, या कूरियर का नाम बोलिए। कोट फेल हो तो दोबारा बोलिए।',
  'help.lead': 'आप ठीक कर रहे हैं — यहाँ स्थिति है।',
  'help.fallback': 'प्रोडक्ट नाम से खोज बोलिए, या अपना पिछला सवाल जारी रखिए।',
  'help.discoveryAddSteps':
    'कदम एक, खोज। कदम दो, मात्रा। कदम तीन, कार्ट। फिर सप्लायर, विकल्प, ऑर्डर विवरण, ट्रांसपोर्ट, और पुष्टि — सब इसी कॉल में।',

  'checkout.emptyCartVoice':
    'आपका कार्ट खाली है। पहले प्रोडक्ट का नाम बोलिए, जैसे Mac Air M2.',
  'checkout.supplierRankFailed': 'सप्लायर लोड नहीं हो पाए: {error}. थोड़ी देर बाद कोशिश करिए।',
  'checkout.noSuppliersAvailable':
    'इस प्रोडक्ट के लिए अभी सप्लायर उपलब्ध नहीं। दूसरा प्रोडक्ट आज़माइए।',
  'checkout.poPrepareFailed': 'खरीद ऑर्डर तैयार नहीं हो पाया: {error}',
  'checkout.noPoGroups': 'खरीद ऑर्डर नहीं बना। सप्लायर चयन जाँचिए।',

  'checkout.placeOrderNeedItems':
    'ऑर्डर से पहले प्रोडक्ट जोड़िए और सप्लायर चुनिए।',
  'checkout.orderCreationFailed': 'ऑर्डर नहीं बना: {error}',
  'checkout.ordersNotCreated': 'ऑर्डर नहीं बने। वेबसाइट पर पूरा करिए।',
  'checkout.orderCreatedTransportFailed':
    'ऑर्डर बन गया{orderRef}, लेकिन ट्रांसपोर्ट बुक नहीं हुआ: {error}. वेबसाइट पर ट्रांसपोर्ट पूरा करिए।',

  'confirm.rejectStartAgain': 'ऑर्डर नहीं हुआ। फिर प्रोडक्ट नाम से शुरू करिए।',
  'supplier.pincodeIs': 'पिनकोड {digits}',
  'supplier.locatedWithPin': '{loc} में, {pinPart}',
  'supplier.locatedOnly': '{loc} में स्थित',
  'supplier.pinOnly': '{pinPart}',
  'supplier.partPrice': 'कीमत {price} रुपये',
  'supplier.partStock': 'स्टॉक में {stock}',
  'supplier.partDist': 'लगभग {distKm} किलोमीटर दूर',
  'supplier.partRating': 'रेटिंग {rating} में से 5',
  'supplier.partLead': 'डिलीवरी लगभग {days} दिन',
  'supplier.detailLine': 'सप्लायर {index}, {name}. {parts}.',
  'supplier.introOne': 'अच्छी खबर — इस प्रोडक्ट के लिए एक मजबूत सप्लायर।',
  'supplier.introMany': 'आपके पास {count} सप्लायर — अच्छे विकल्प।',
  'supplier.pickInstruction': 'सप्लायर नंबर बोलिए, या सप्लायर का नाम बोलिए।',
  'supplier.retry':
    'समझ नहीं आया। सप्लायर एक से {max} तक नंबर बोलिए, या नाम बोलिए।',
  'supplier.chosenNoLoc': 'बढ़िया — {name} लॉक हो गया।',
  'supplier.chosenWithLoc': 'बढ़िया — {name} लॉक, {loc}।',

  'sub.noAfterChosen': 'विकल्प नहीं मिला। ऑर्डर विवरण पर चलते हैं।',
  'sub.introOne':
    'एक विकल्प मिला: {lines}. छोड़ने के लिए विकल्प नहीं, सब स्वीकार के लिए हाँ बोलिए।',
  'sub.introMany':
    '{count} विकल्प मिले: {lines}. छोड़ने के लिए विकल्प नहीं, सब स्वीकार के लिए हाँ बोलिए।',
  'sub.retry': 'छोड़ने के लिए विकल्प नहीं, स्वीकार के लिए हाँ बोलिए।',
  'sub.suggestionLine': 'सुझाव {index}, {title}',
  'sub.placeholderSupplier': 'आपका सप्लायर',
  'supplier.thisSupplier': 'यह सप्लायर',

  'po.requiredDate':
    'डिलीवरी तारीख क्या रखूँ? तारीख बोलिए, जैसे 20 मई 2026, या डिफ़ॉल्ट बोलिए।',
  'po.payment':
    'भुगतान कैसे? कैश ऑन डिलीवरी, ऑनलाइन, या बैंक ट्रांसफर बोलिए।',
  'po.address': 'शिपिंग पता {shipLine} है। पुष्टि के लिए हाँ बोलिए।',
  'po.addressFromProfile': 'आपकी प्रोफ़ाइल से',
  'po.dateRetry': 'तारीख बोलिए, जैसे 2026-05-20, या डिफ़ॉल्ट बोलिए।',
  'po.paymentRetry': 'कैश ऑन डिलीवरी, ऑनलाइन, या बैंक ट्रांसफर बोलिए।',
  'po.addressRetry': 'पता पुष्टि के लिए हाँ बोलिए।',

  'pay.cod': 'कैश ऑन डिलीवरी',
  'pay.online': 'ऑनलाइन भुगतान',
  'pay.bank': 'बैंक ट्रांसफर',
  'pay.notSet': 'सेट नहीं',

  'confirm.summary':
    'ऑर्डर सारांश सुनिए। {groups}. कुल लगभग {grandTotal} रुपये। डिलीवरी {requiredDate} तक। भुगतान {pay}.{transportPart} पुष्टि के लिए ऑर्डर प्लेस बोलिए, रद्द के लिए नहीं बोलिए।',
  'confirm.placeRetry': 'पुष्टि के लिए ऑर्डर प्लेस बोलिए, रद्द के लिए नहीं बोलिए।',
  'confirm.placing': 'ठीक है — अभी ऑर्डर लगा रहा हूँ, बस एक पल।',

  'transport.loading':
    'कृपया रुकिए — मैं आपके लिए ट्रांसपोर्ट विकल्प लोड कर रहा हूँ। एक मिनट तक लग सकता है।',
  'transport.optionsIntro':
    'ऑर्डर से पहले ट्रांसपोर्ट चुनना होगा। {vendorLines} ट्रांसपोर्ट नंबर बोलिए, या कूरियर नाम बोलिए।',
  'transport.retry':
    'ऑर्डर से पहले ट्रांसपोर्ट ज़रूरी है। नंबर बोलिए या कूरियर नाम बोलिए।',
  'transport.quotesFailed':
    'कूरियर कोट लोड नहीं हुए.{detail} दोबारा बोलिए, या वेबसाइट पर पिनकोड अपडेट करिए। ट्रांसपोर्ट के बिना ऑर्डर नहीं लगेगा।',
  'transport.logisticsDefault':
    'आपके पते पर ट्रांसपोर्ट कोट नहीं मिले। वेबसाइट पर प्रोफ़ाइल पिनकोड अपडेट करिए।',
  'transport.summarySupplier': 'सप्लायर',
  'transport.vendorFallback': 'सप्लायर',
  'transport.rateRupees': '{rate} रुपये',

  'transport.noQuotes':
    'आपके पते पर कोट नहीं मिला.{detail} दोबारा बोलिए, या प्रोफ़ाइल पता और पिनकोड अपडेट करिए। चेकआउट से पहले ट्रांसपोर्ट ज़रूरी है।',
  'transport.pickRemainingOne': ' एक और सप्लायर के लिए कूरियर चाहिए।',
  'transport.pickRemainingMany': ' {count} सप्लायरों के लिए अभी कूरियर चाहिए।',
  'transport.pickIntro':
    'हर सप्लायर के लिए ट्रांसपोर्ट चुनिए.{extra} नंबर बोलिए या कूरियर नाम बोलिए।',
  'transport.requiredBeforeOrder':
    'ऑर्डर से पहले ट्रांसपोर्ट चुनना ज़रूरी है। दोबारा बोलिए या ट्रांसपोर्ट नंबर बोलिए।',

  'done.withNumber':
    'बस हो गया — ऑर्डर {orderNumbers} लग गया, ट्रांसपोर्ट भी बुक। और कुछ चाहिए तो बोलिए, वरना कॉल समाप्त।',
  'done.withoutNumber':
    'सब तैयार — ऑर्डर और ट्रांसपोर्ट दोनों हो गए। कुछ और चाहिए तो बोलिए, वरना कॉल समाप्त।',

  'status.pleaseWait': 'एक पल रुकिए।',
  'status.transportStill':
    'अभी भी कूरियर और ट्रकिंग विकल्प ला रहा हूँ — मेरे साथ रहिए, बस होने वाला है।',
  'status.updatingProduct': 'एक सेकंड — आपका प्रोडक्ट अपडेट कर रहा हूँ…',
  'status.openingCart': 'कार्ट खोल रहा हूँ…',
  'status.loadingSupplier': 'सप्लायर की जानकारी ला रहा हूँ…',
  'status.checkingSubstitution': 'विकल्प देख रहा हूँ…',
  'status.openingPo': 'खरीद ऑर्डर खोल रहा हूँ…',
  'status.catalog': 'एक सेकंड — कैटलॉग देख रहा हूँ…',
  'status.transport':
    'कृपया रुकिए — ट्रांसपोर्ट सुझाव खोलकर कूरियर कोट ला रहा हूँ।',
  'status.order': 'ऑर्डर लगा रहा हूँ — बस होने वाला है…',

  'error.noAudio': 'कुछ सुनाई नहीं दिया। एक बार फिर बोलिए।',
  'error.noCatch': 'माफ़ कीजिए, छूट गया — एक बार फिर बोलिए?',
  'error.pipeline': 'छोटी सी समस्या हुई। थोड़ी देर बाद फिर कोशिश करिए।',
  'error.unknownPending': 'यह कदम पहचान में नहीं आया।',

  'call.ending': 'ठीक है — कॉल समाप्त कर रहा हूँ।',
  'call.cancelled': 'ठीक है, रद्द कर दिया।',

  'confirm.waiting':
    'मैं {summary} के लिए आपकी पुष्टि का इंतज़ार कर रहा हूँ। पुष्टि के लिए हाँ बोलिए, रद्द के लिए नहीं बोलिए।',

  'greeting.default':
    'नमस्ते, प्रांशु — Tatva पर आपका स्वागत है। कार्ट से आगे बढ़ें, या नए प्रोडक्ट से शुरू करें?',
  'thanks.default': 'खुशी से मदद की। कॉल खत्म करने से पहले और कुछ चाहिए?',

  'tool.addedToCart': '{name} कार्ट में जोड़ दिया।',
  'tool.qtyIncreased': '{name} की मात्रा कार्ट में बढ़ा दी।',
  'tool.productNotFound': 'प्रोडक्ट नहीं मिला। पहले खोजिए, फिर कार्ट में जोड़ो बोलिए।',
  'tool.productNotFoundQuery':
    'प्रोडक्ट "{query}" नहीं मिला। पहले खोजिए, फिर कार्ट में जोड़ो बोलिए।',
  'tool.cartCleared': 'कार्ट खाली कर दिया।',
  'tool.clearCartHint': 'कार्ट खाली करो बोलिए, या आइटम का नाम बोलकर हटाइए।',
  'tool.cartEmpty': 'आपका कार्ट खाली है।',
  'tool.cartItems': 'कार्ट में {count} आइटम: {names}{more}',
  'tool.ordersLoadFailed': 'ऑर्डर लोड नहीं हो पाए।',
  'tool.noOrders': 'कोई हालिया ऑर्डर नहीं मिला।',
  'tool.recentOrders': 'हाल के ऑर्डर: {lines}',
  'tool.reorderAdded': 'पिछले ऑर्डर से आइटम जोड़ दिए।',
  'tool.stockNeedSearch': 'आखिरी खोज के प्रोडक्ट के लिए स्टॉक चेक बोलिए।',

  'smart.fallback':
    'मैं Tatva पर प्रोडक्ट, कार्ट, चेकआउट, रिटर्न, शिपिंग, पेमेंट — सब में साथ हूँ। मेरा कार्ट दिखाओ या रिफंड पूछिए।',
  'smart.retryHint': 'प्रोडक्ट का नाम बताइए, या मेरा कार्ट बोलिए — आगे बढ़ते हैं।',
  'smart.done': 'हो गया।',

  'summarize.cartEmpty': 'आपका कार्ट खाली है।',
  'summarize.cartItems': 'कार्ट में {count} आइटम: {names}{more}',
  'summarize.productNotFound': 'प्रोडक्ट नहीं मिल पाया।',
  'summarize.productNotFoundQuery': 'प्रोडक्ट "{query}" नहीं मिल पाया।',
  'summarize.searchIntro':
    '{total} प्रोडक्ट मिले। {lines}. कार्ट में जोड़ो बोलिए, फिर मात्रा बताइए।',

  'search.productLine': 'नंबर {index}, {parts}',
  'search.unnamedProduct': 'यह प्रोडक्ट',
  'search.unnamedLabel': 'प्रोडक्ट',

  'support.fallback':
    'इस पर पक्का नहीं हूँ — नीतियों में नहीं मिला। ऑर्डर पेज देखिए या सपोर्ट से बात करिए।',

  'transport.optionLine': 'विकल्प {index}, {name}, {rate}',
  'transport.forVendor': '{vendorName} के लिए: {options}',
  'transport.noQuotesLine': 'कोई कोट नहीं',
  'transport.courierDefault': 'कूरियर',

  'ws.busy': 'अभी प्रोसेस हो रहा है',
  'ws.authFailed': 'टोकन अमान्य है',
  'nav.ordersScreenLabel': 'आपके ऑर्डर',

  'tools.groupOrderFailed': 'ऑर्डर ग्रुप नहीं बना: {error}',
  'tools.noPoGroups': 'खरीद ऑर्डर ग्रुप नहीं बन पाए।',
  'tools.orderCreationFailed': 'ऑर्डर नहीं बना: {error}',
  'tools.cancelFailed': 'रद्द नहीं हो सका: {error}',
  'tools.paymentSetupFailed': 'पेमेंट सेटअप विफल: {error}',
  'tools.paymentIntentCreated':
    'ऑनलाइन पेमेंट इंटेंट बन गया। ऐप में पेमेंट पूरा करिए। {detail}',
  'tools.searchFailed': 'खोज विफल: {error}',
  'tools.inventoryCheckFailed': 'इन्वेंटरी जाँच विफल: {error}',
  'tools.cartLoadFailed': 'कार्ट लोड नहीं हुआ: {error}',
  'tools.addToCartFailed': 'कार्ट में जोड़ना विफल: {error}',
  'tools.updateFailed': 'अपडेट विफल: {error}',
  'tools.clearCartFailed': 'कार्ट खाली करना विफल: {error}',
  'tools.cartItemNotFound': 'कार्ट आइटम नहीं मिला।',
  'tools.removeFailed': 'हटाना विफल: {error}',
  'tools.trackFailed': 'ट्रैक विफल: {error}',
  'tools.cancelOrderConfirm':
    'ऑर्डर {orderId} रद्द कर सकता हूँ। हाँ पुष्टि, नहीं रद्द।',
  'tools.orderLoadFailed': 'ऑर्डर लोड नहीं हुआ: {error}',
  'tools.cartEmptyCheckout': 'कार्ट खाली है। चेकआउट से पहले प्रोडक्ट जोड़िए।',
  'tools.placeOrderConfirm':
    '{count} आइटम के साथ ऑर्डर ({paymentMethod}). हाँ पुष्टि, नहीं रद्द।',
  'tools.onlinePaymentConfirm':
    'ऑर्डर {orderId} के लिए ऑनलाइन पेमेंट शुरू कर सकता हूँ। हाँ पुष्टि, नहीं रद्द।',
  'tools.bankTransferFailed': 'बैंक ट्रांसफर अनुरोध विफल: {error}',
  'tools.profileLoadFailed': 'प्रोफ़ाइल लोड नहीं हुई: {error}',
  'tools.addressUpdateFailed': 'पता अपडेट विफल: {error}',
  'tools.unknownTool': 'अज्ञात टूल: {name}',
  'tools.toolError': 'कार्रवाई में समस्या। दोबारा कोशिश करिए।',

  'product.unnamed': 'आइटम',

  'ui.connecting': 'कनेक्ट हो रहा है…',
  'ui.listening': 'सुन रहा हूँ…',
  'ui.thinking': 'एक पल…',
  'ui.transportLoading': 'ट्रांसपोर्ट विकल्प लोड हो रहे हैं…',
  'ui.speaking': 'बोल रहा हूँ…',
  'ui.error': 'त्रुटि',
  'ui.disconnected': 'डिस्कनेक्ट',
  'ui.voiceAssistantActive': 'वॉयस असिस्टेंट सक्रिय',
  'ui.stillWorking': 'अभी काम हो रहा है… दोबारा बोल सकते हैं, या थोड़ी देर बाद दोहराइए।',
  'ui.micDenied': 'माइक्रोफ़ोन की अनुमति नहीं मिली',
  'ui.browserUnsupported': 'वॉयस के लिए Chrome या Edge इस्तेमाल करिए।',
  'ui.connectionLost': 'कनेक्शन टूट गया। कॉल खत्म बोलिए, फिर Start speaking दबाइए।',
  'ui.sendFailed': 'भेजना नहीं हुआ। कॉल खत्म बोलिए या End call दबाइए।',
  'ui.genericError': 'त्रुटि — कॉल सक्रिय है। दोबारा बोलिए।',
  'ui.reconnecting': 'फिर कनेक्ट हो रहा है… कॉल सक्रिय है।',
  'ui.connectingRetry': 'कनेक्ट हो रहा है… थोड़ी देर बाद कोशिश करें।'
};
