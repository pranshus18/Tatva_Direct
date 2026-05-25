/** English voice strings — canonical keys for getVoiceText fallback. */
export const enVoiceTexts = {
  'language.select':
    'Hey, welcome to Tatva — I\'m Pranshu. Which language feels best? English, Hinglish, Hindi, Kannada, or Telugu — just say it.',
  'language.unknown':
    'Sorry, I missed that. Say English, Hinglish, Hindi, Kannada, or Telugu — whichever you prefer.',
  'language.changed':
    'Thank you for selecting {languageName}. How can I help you today?',
  'language.changed.hinglish':
    'Thanks for choosing {languageName}. Bataiye, main aapki kaise help kar sakta hoon?',

  'flow.stepPrefix': 'Step {n}, {label}. ',
  'flow.stepLabel.search': 'Product search',
  'flow.stepLabel.quantity': 'Quantity',
  'flow.stepLabel.cart': 'Cart',
  'flow.stepLabel.suppliers': 'Supplier selection',
  'flow.stepLabel.substitution': 'Substitution',
  'flow.stepLabel.po_details': 'Purchase order details',
  'flow.stepLabel.transport': 'Transport selection',
  'flow.stepLabel.confirm_order': 'Order confirmation',
  'flow.stepLabel.done': 'Complete',
  'search.productLine': '{index}. {name}',
  'cart.itemsCountOne': '1 item',
  'cart.itemsCountMany': '{count} items',
  'supplier.fallbackName': 'Supplier',
  'sub.defaultTitle': 'suggested item',
  'confirm.groupLine': 'Order {index}, {vendor}, {total} rupees',
  'confirm.transportPart': ' Transport: {transportSummary}.',

  'confirm.pendingDefault': 'complete this action',
  'confirm.pendingPoDetails': 'purchase order details',

  'search.single':
    'Nice, I found {productName}. Shall we pop it in your cart? Say add to cart, or number 1.',
  'search.multiple':
    'I pulled up {total} options. {lines}. Which one catches your eye — number or name?',
  'search.notFound.withQuery':
    'No exact match for "{query}" yet — no worries. Try the name again, or something shorter like cement, steel rod, or Mac Air.',
  'search.notFound.noQuery':
    'I didn\'t spot that one yet. Tell me the product you need — cement, Mac Air M2, anything you\'re buying.',
  'search.fuzzy': 'I heard "{query}". Here are {total} close matches: {lines}. Say the product number or name.',
  'search.askQuantity': 'Great pick. How many {productName}? Just say the number.',
  'search.pickProduct': 'Which one do you want? {choices}. Number or name — your call.',
  'ui.heardYouSay': 'I heard:',
  'stt.didNotCatch':
    'I may have misheard that. Please say it again clearly — product name, quantity, or say add to cart.',
  'search.requestTimeout': 'Search timed out. Try a shorter product name.',
  'search.serviceUnavailable': 'I could not search right now. Please try again.',

  'cart.added': '{productName} is in your cart now.',
  'cart.qtyIncreased': 'Added more {productName} to your cart.',
  'cart.continue': 'Cart\'s on screen — when you\'re ready, say continue or pick a supplier.',
  'cart.discoveryHandoff':
    'Peek at your screen — looks good? Say continue when you\'re ready, or tell me your supplier.',
  'cart.withItems.cart': 'Your cart has {items}. Say continue, or select supplier.',
  'cart.withItems.discovery':
    'Your cart has {items}. Say continue, select supplier, or search another product.',
  'cart.checkoutOnly':
    'Checkout is continuing from cart. Say continue or select supplier. For a new item, say go to product discovery.',
  'cart.empty': 'Your cart is empty. Say a product name, or say go to product discovery.',
  'cart.checkoutCancelled':
    'Okay, checkout is cancelled. If you want, we can search another product.',
  'cart.addFailed': 'Could not add {productName} to cart.',
  'cart.needSearchBeforeAdd': 'Search for a product first, then say add to cart.',
  'cart.searchProductNameFirst':
    'Step 1, search. Say a product name first, for example Mac Air M2.',

  'nav.productDiscovery': 'You are on Product discovery. Say a product name and I will search.',
  'nav.orders': 'Opening Your orders. Your past orders are on screen.',
  'nav.generic': 'Opening {label}. Tell me what you want to do next.',
  'nav.screen.cart': 'Cart',
  'nav.screen.supplier_select': 'Supplier selection',
  'nav.screen.substitution': 'Substitution',
  'nav.screen.create_po': 'Create purchase order',
  'nav.screen.transport': 'Transport',
  'nav.resumeCheckout': 'Okay, continuing checkout from your cart.',

  'help.cartMode':
    'You are in cart checkout mode. Review your cart, then say continue and I will take you from supplier selection to placing the order.',
  'help.discoveryMode':
    'We\'re on product hunt together — name it, pick from the list, say how many, then cart. Stuck? Say help anytime. Ready to checkout? Say go to my cart.',
  'help.await_add_quantity': 'Say how many you want — for example 2, two, or two nos.',
  'help.await_pick_product':
    'Say the product number from the list, or say add to cart for the one I found.',
  'help.await_discovery_cart_handoff':
    'Added to your cart. Review on screen, then say continue or select supplier.',
  'help.await_cart_continue':
    'Review your cart on screen. Say continue or select supplier when you are ready.',
  'help.await_select_supplier': 'Say supplier number 1, or say the supplier name.',
  'help.await_substitution': 'Say no substitution to skip, or yes to accept suggestions.',
  'help.await_po_requiredDate': 'Say a delivery date like 20 May 2026, or say default.',
  'help.await_po_payment': 'Say cash on delivery, online, or bank transfer.',
  'help.await_po_addresses': 'Say yes to confirm your shipping address.',
  'help.await_po_generic': 'Answer the question I just asked about your order.',
  'help.await_place_confirm': 'Say place the order to buy, or say no to cancel.',
  'help.await_transport':
    'Say transport number 1, or say the courier name. If quotes failed, say retry.',
  'help.lead': 'You\'re doing fine — here\'s where we are.',
  'help.fallback': 'Say a product name to search, or pick up your last question.',
  'help.discoveryAddSteps':
    'Step 1, search. Step 2, quantity. Step 3, cart. Then supplier, substitution, PO details, transport, and confirm order — all in this call.',

  'checkout.emptyCartVoice': 'Your cart is empty. Say a product name to search first, for example Mac Air M2.',
  'checkout.supplierRankFailed': 'I could not load suppliers: {error}. Try again in a moment.',
  'checkout.noSuppliersAvailable':
    'No suppliers are available for this product right now. Try another product.',
  'checkout.poPrepareFailed': 'I could not prepare your purchase order: {error}',
  'checkout.noPoGroups': 'No purchase order could be created. Please check your supplier selection.',

  'checkout.placeOrderNeedItems':
    'Add a product and choose a supplier before placing an order.',
  'checkout.orderCreationFailed': 'Order creation failed: {error}',
  'checkout.ordersNotCreated': 'Orders were not created. Please finish on the website.',
  'checkout.orderCreatedTransportFailed':
    'Order created{orderRef}, but transport booking failed: {error}. Finish transport on the website.',

  'confirm.rejectStartAgain': 'Order not placed. Say a product name to start again.',
  'supplier.pincodeIs': 'pincode is {digits}',
  'supplier.locatedWithPin': 'located in {loc}, {pinPart}',
  'supplier.locatedOnly': 'located in {loc}',
  'supplier.pinOnly': '{pinPart}',
  'supplier.partPrice': 'price {price} rupees',
  'supplier.partStock': '{stock} in stock',
  'supplier.partDist': '{distKm} kilometres away',
  'supplier.partRating': 'rating {rating} out of 5',
  'supplier.partLead': 'delivery about {days} days',
  'supplier.detailLine': 'Supplier {index}, {name}. {parts}.',
  'supplier.introOne': 'Good news — one strong supplier for this product.',
  'supplier.introMany': 'You\'ve got {count} suppliers to choose from — nice options.',
  'supplier.pickInstruction': 'Say the supplier number, or say the supplier name.',
  'supplier.retry': 'I did not catch that. Say a supplier number from 1 to {max}, or say the supplier name.',
  'supplier.chosenNoLoc': 'Great — {name} is locked in.',
  'supplier.chosenWithLoc': 'Great — {name} is locked in, {loc}.',

  'sub.noAfterChosen': 'No substitution options found. Moving to order details.',
  'sub.introOne':
    'I found 1 substitution option: {lines}. Say no substitution to skip, or say yes to accept all.',
  'sub.introMany':
    'I found {count} substitution options: {lines}. Say no substitution to skip, or say yes to accept all.',
  'sub.retry': 'Say no substitution to skip, or yes to accept.',
  'sub.suggestionLine': 'Suggestion {index}, {title}',
  'sub.placeholderSupplier': 'your supplier',
  'supplier.thisSupplier': 'this supplier',

  'po.requiredDate':
    'What delivery date should I use? Say a date like 20 May 2026, or say default.',
  'po.payment': 'How will you pay? Say cash on delivery, online payment, or bank transfer.',
  'po.address': 'Shipping address is {shipLine}. Say yes to confirm.',
  'po.addressFromProfile': 'from your profile',
  'po.dateRetry': 'Say a date like 2026-05-20, or say default.',
  'po.paymentRetry': 'Say cash on delivery, online, or bank transfer.',
  'po.addressRetry': 'Say yes to confirm the address.',

  'pay.cod': 'cash on delivery',
  'pay.online': 'online payment',
  'pay.bank': 'bank transfer',
  'pay.notSet': 'not set',

  'confirm.summary':
    'Here is your order summary. {groups}. Grand total about {grandTotal} rupees. Delivery by {requiredDate}. Payment: {pay}.{transportPart} Say place the order to confirm, or say no to cancel.',
  'confirm.placeRetry': 'Say place the order to confirm, or say no to cancel.',
  'confirm.placing': 'Okay, placing your order now. One second.',

  'transport.loading':
    'Please wait — I am loading transport options for you. This can take up to a minute.',
  'transport.optionsIntro':
    'Choose transport before placing the order. {vendorLines} Say the transport number, or say the courier name.',
  'transport.retry':
    'Transport is required before placing the order. Say a number or the courier name.',
  'transport.quotesFailed':
    'I could not load courier quotes.{detail} Say retry to try again, or update shipping pincode on the website. The order cannot be placed without transport.',
  'transport.noQuotes':
    'No courier quotes are available for your address.{detail} Say retry, or update profile address and pincode on the website. Transport is required before checkout.',
  'transport.logisticsDefault':
    'No transport quotes for your delivery address. Update your profile pincode on the website.',
  'transport.summarySupplier': 'supplier',
  'transport.vendorFallback': 'Supplier',
  'transport.rateRupees': '{rate} rupees',
  'transport.pickRemainingOne': ' One more supplier needs a courier.',
  'transport.pickRemainingMany': ' {count} suppliers still need a courier.',
  'transport.pickIntro':
    'Open transport suggestion on your screen — pick one option per supplier.{extra} Say a number or the courier name.',
  'transport.requiredBeforeOrder':
    'You must choose transport before placing the order. Say retry or say the transport number.',

  'done.withNumber':
    'And we\'re done — order {orderNumbers} is placed, transport booked. Need anything else, or say end the call.',
  'done.withoutNumber':
    'All done — order placed and transport booked. Anything else, or say end the call when you\'re good.',

  'status.pleaseWait': 'One moment please.',
  'status.transportStill':
    'Still fetching courier and trucking options — please stay with me, almost there.',
  'status.updatingProduct': 'Updating your product selection…',
  'status.openingCart': 'Opening your cart…',
  'status.loadingSupplier': 'Loading supplier details…',
  'status.checkingSubstitution': 'Checking substitutions…',
  'status.openingPo': 'Opening purchase order…',
  'status.catalog': 'Checking the catalog…',
  'status.transport':
    'Please wait — I am opening transport suggestions and loading courier quotes for you.',
  'status.order': 'Placing your order now.',

  'error.noAudio': "I didn't hear anything. Please try again.",
  'error.noCatch': "Sorry, I missed that — say it once more?",
  'error.pipeline': 'Something went wrong. Please try again in a moment.',
  'error.unknownPending': 'Unknown pending action.',

  'call.ending': 'All set. Ending the call now.',
  'call.cancelled': 'Okay, cancelled.',

  'confirm.waiting':
    "I'm waiting for your confirmation to {summary}. Say yes to confirm or no to cancel.",

  'greeting.default':
    'Hey, Pranshu here from Tatva. Great to have you on the line. Picking up from your cart, or starting fresh with a new product?',
  'greeting.hinglish':
    'Hi, Pranshu here. Cart se continue karein, ya fresh product se start karein?',
  'thanks.default': 'Happy to help. Anything else before we wrap the call?',

  'tool.addedToCart': '{name} added to your cart.',
  'tool.qtyIncreased': 'Added more {name} to your cart.',
  'tool.productNotFound': 'I am not able to find the product. Search first, then say add to cart.',
  'tool.productNotFoundQuery':
    'I am not able to find the product "{query}". Search for it first, then say add to cart.',
  'tool.cartCleared': 'Cart cleared.',
  'tool.clearCartHint': 'Say clear cart, or remove by item name.',
  'tool.cartEmpty': 'Your cart is empty.',
  'tool.cartItems': 'Cart has {count} items: {names}{more}',
  'tool.ordersLoadFailed': 'Could not load orders.',
  'tool.noOrders': 'You have no recent orders.',
  'tool.recentOrders': 'Recent orders: {lines}',
  'tool.reorderAdded': 'Items added from your previous order.',
  'tool.stockNeedSearch': 'Say check stock for a product from your last search.',

  'smart.fallback':
    'I\'m here for products, cart, checkout, returns, shipping, payments — whatever you need on Tatva. Try show my cart, or ask how refunds work.',
  'smart.retryHint': 'Tell me a product name, or say show my cart — we\'ll take it from there.',
  'smart.done': 'Done.',

  'summarize.cartEmpty': 'Your cart is empty.',
  'summarize.cartItems': 'Cart has {count} items: {names}{more}',
  'summarize.productNotFound': 'I am not able to find the product.',
  'summarize.productNotFoundQuery': 'I am not able to find the product "{query}".',
  'summarize.searchIntro':
    'Found {total} product(s). {lines}. Say add to cart, then tell me how many.',

  'search.productLine': 'Number {index}, {parts}',
  'search.unnamedProduct': 'this product',
  'search.unnamedLabel': 'Product',

  'support.fallback':
    "I'm not sure about that — I don't have it in our policies. Check your orders page or contact support and they'll help you out.",

  'transport.optionLine': 'option {index}, {name}, {rate}',
  'transport.forVendor': 'For {vendorName}: {options}',
  'transport.noQuotesLine': 'no quotes',
  'transport.courierDefault': 'Courier',

  'ws.busy': 'Still processing',
  'ws.authFailed': 'Invalid token',
  'nav.ordersScreenLabel': 'Your orders',

  'tools.groupOrderFailed': 'Could not group order: {error}',
  'tools.noPoGroups': 'No purchase order groups could be created.',
  'tools.orderCreationFailed': 'Order creation failed: {error}',
  'tools.cancelFailed': 'Cancel failed: {error}',
  'tools.paymentSetupFailed': 'Payment setup failed: {error}',
  'tools.paymentIntentCreated':
    'Online payment intent created. Complete payment in the app if prompted. {detail}',
  'tools.searchFailed': 'Search failed: {error}',
  'tools.inventoryCheckFailed': 'Inventory check failed: {error}',
  'tools.cartLoadFailed': 'Could not load cart: {error}',
  'tools.addToCartFailed': 'Add to cart failed: {error}',
  'tools.updateFailed': 'Update failed: {error}',
  'tools.clearCartFailed': 'Clear cart failed: {error}',
  'tools.cartItemNotFound': 'Cart item not found.',
  'tools.removeFailed': 'Remove failed: {error}',
  'tools.trackFailed': 'Track failed: {error}',
  'tools.cancelOrderConfirm':
    'I can cancel order {orderId}. Say yes to confirm, or no to cancel.',
  'tools.orderLoadFailed': 'Could not load order: {error}',
  'tools.cartEmptyCheckout': 'Your cart is empty. Add products before checkout.',
  'tools.placeOrderConfirm':
    'Ready to place order with {count} items ({paymentMethod}). Say yes to confirm, or no to cancel.',
  'tools.onlinePaymentConfirm':
    'I can start online payment for order {orderId}. Say yes to confirm, or no to cancel.',
  'tools.bankTransferFailed': 'Bank transfer request failed: {error}',
  'tools.profileLoadFailed': 'Could not load profile: {error}',
  'tools.addressUpdateFailed': 'Address update failed: {error}',
  'tools.unknownTool': 'Unknown tool: {name}',
  'tools.toolError': 'Something went wrong with that action. Please try again.',

  'product.unnamed': 'item',

  'ui.connecting': 'Connecting…',
  'ui.listening': 'Listening…',
  'ui.thinking': 'One moment…',
  'ui.transportLoading': 'Loading transport options…',
  'ui.speaking': 'Speaking…',
  'ui.error': 'Error',
  'ui.disconnected': 'Disconnected',
  'ui.voiceAssistantActive': 'Voice assistant active',
  'ui.stillWorking':
    'Still working… you can speak again, or wait a moment and repeat.',
  'ui.micDenied': 'Microphone permission denied',
  'ui.browserUnsupported': 'Use Chrome or Edge for voice.',
  'ui.connectionLost': 'Connection lost. Say end the call, then tap Start speaking again.',
  'ui.sendFailed': 'Could not send. Say end call or tap End call.',
  'ui.genericError': 'Error — call still active. Speak again.',
  'ui.reconnecting': 'Reconnecting… call still active.',
  'ui.connectingRetry': 'Connecting… try again in a moment.'
};
