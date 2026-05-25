import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAddToCartIntent,
  isCartContinuePhrase,
  isCheckoutCommandPhrase,
  isConfirmPhrase,
  isDefaultDatePhrase,
  isGreetingPhrase,
  isHelpPhrase,
  isNoSubstitutionPhrase,
  isOpenCartPhrase,
  isOrderTrackPhrase,
  isPlaceOrderPhrase,
  isRejectPhrase,
  isSearchCommandPhrase,
  isSupportTopicPhrase,
  isThanksPhrase,
  isTransportRetryPhrase,
  parseGoToScreenIntent,
  parsePaymentMethodPhrase
} from '../voice/lib/voiceIntentPhrases.js';
import { parseQuantity } from '../voice/lib/spokenNumbers.js';

test('multilingual add to cart intents', () => {
  assert.equal(isAddToCartIntent('add to cart'), true);
  assert.equal(isAddToCartIntent('cart me add karo'), true);
  assert.equal(isAddToCartIntent('ಕಾರ್ಟ್‌ಗೆ ಸೇರಿಸಿ'), true);
  assert.equal(isAddToCartIntent('కార్ట్‌లో చేర్చు'), true);
  assert.equal(isAddToCartIntent('कार्ट में जोड़ो'), true);
});

test('multilingual confirm and continue', () => {
  assert.equal(isConfirmPhrase('haan'), true);
  assert.equal(isConfirmPhrase('howdu'), true);
  assert.equal(isConfirmPhrase('avunu'), true);
  assert.equal(isCartContinuePhrase('jari rakho'), true);
  assert.equal(isCartContinuePhrase('munduvarisu'), true);
  assert.equal(isCartContinuePhrase('aage badho'), true);
  assert.equal(isCartContinuePhrase('అవును'), true);
});

test('multilingual help and reject', () => {
  assert.equal(isHelpPhrase('madad'), true);
  assert.equal(isHelpPhrase('ಸಹಾಯ'), true);
  assert.equal(isRejectPhrase('nahi'), true);
  assert.equal(isRejectPhrase('beda'), true);
});

test('regional quantity words', () => {
  assert.equal(parseQuantity('do'), 2);
  assert.equal(parseQuantity('eradu'), 2);
  assert.equal(parseQuantity('rendu'), 2);
  assert.equal(parseQuantity('दो'), 2);
});

test('navigation intents in indic languages', () => {
  assert.equal(parseGoToScreenIntent('mera cart'), 'cart');
  assert.equal(parseGoToScreenIntent('ನನ್ನ ಕಾರ್ಟ್'), 'cart');
});

test('multilingual routing intents', () => {
  assert.equal(isGreetingPhrase('namaste'), true);
  assert.equal(isGreetingPhrase('ನಮಸ್ಕಾರ'), true);
  assert.equal(isThanksPhrase('धन्यवाद'), true);
  assert.equal(isSupportTopicPhrase('refund kaise'), true);
  assert.equal(isSupportTopicPhrase('రిఫండ్'), true);
  assert.equal(isOrderTrackPhrase('mera order'), true);
  assert.equal(isOrderTrackPhrase('నా ఆర్డర్'), true);
  assert.equal(isCheckoutCommandPhrase('order place karo'), true);
  assert.equal(isCheckoutCommandPhrase('చెక్‌అవుట్'), true);
  assert.equal(isOpenCartPhrase('mera cart'), true);
  assert.equal(isOpenCartPhrase('నా కార్ట్'), true);
  assert.equal(isSearchCommandPhrase('cement khojo'), true);
  assert.equal(isSearchCommandPhrase('సిమెంట్ వెతక'), true);
});

test('checkout step phrases', () => {
  assert.equal(isDefaultDatePhrase('default'), true);
  assert.equal(isDefaultDatePhrase('default heli'), true);
  assert.equal(isPlaceOrderPhrase('place the order'), true);
  assert.equal(isNoSubstitutionPhrase('no substitution'), true);
  assert.equal(isNoSubstitutionPhrase('विकल्प नहीं'), true);
  assert.equal(parsePaymentMethodPhrase('कैश ऑन डिलीवरी'), 'cod');
  assert.equal(isTransportRetryPhrase('ಮತ್ತೆ ಪ್ರಯತ್ನ'), true);
});
