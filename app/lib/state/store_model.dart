import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:crypto/crypto.dart';

import '../data/commerce_api.dart';
import '../data/local_drafts.dart';
import '../data/models.dart';

class StoreModel extends ChangeNotifier {
  StoreModel({required this.api, required this.drafts});
  final CommerceApi api;
  final LocalDrafts drafts;
  Catalog? catalog;
  bool loading = true;
  String? error;
  String locale = 'en', destination = 'US';
  final Map<String, int> bag = {};
  final Set<String> favorites = {};
  Future<void> _writes = Future.value();
  bool _disposed = false;
  int _catalogRequest = 0;
  String? _checkoutKey, _checkoutHash;

  Future<void> initialize() async {
    try {
      final raw = await drafts.read();
      if (raw != null) {
        final value = jsonDecode(raw) as Map<String, dynamic>;
        if (['en', 'zh', 'es'].contains(value['locale'])) {
          locale = value['locale'] as String;
        }
        destination = value['destination'] as String? ?? 'US';
        _checkoutKey = value['checkoutKey'] as String?;
        _checkoutHash = value['checkoutHash'] as String?;
        final lines = value['bag'] as Map<String, dynamic>? ?? {};
        for (final entry in lines.entries) {
          if (entry.value is int && entry.value > 0 && entry.value <= 10) {
            bag[entry.key] = entry.value as int;
          }
        }
        favorites.addAll(
          (value['favorites'] as List? ?? []).whereType<String>(),
        );
      }
    } catch (_) {
      /* Corrupted preferences do not prevent shopping. */
    }
    await reload();
  }

  Future<void> reload() async {
    final request = ++_catalogRequest;
    loading = true;
    error = null;
    _notify();
    try {
      final latest = await api.catalog();
      if (_disposed || request != _catalogRequest) return;
      catalog = latest;
      if (!catalog!.destinations.containsKey(destination)) destination = 'US';
      final listings = catalog!.products.map((product) => product.id).toSet();
      final available = {
        for (final product in catalog!.products)
          for (final variant in product.saleVariants) variant.id: variant,
      };
      bag.removeWhere((id, _) => !available.containsKey(id));
      favorites.removeWhere((id) => !listings.contains(id));
      for (final entry in bag.entries.toList()) {
        bag[entry.key] = min(entry.value, min(10, available[entry.key]!.inventory));
      }
      bag.removeWhere((_, quantity) => quantity <= 0);
    } catch (exception) {
      if (_disposed || request != _catalogRequest) return;
      error = exception.toString();
    }
    loading = false;
    _notify();
  }

  Product? product(String id) {
    for (final product in catalog?.products ?? <Product>[]) {
      if (product.id == id) return product;
    }
    return null;
  }

  Product? sku(String id) {
    for (final listing in catalog?.products ?? <Product>[]) {
      for (final variant in listing.saleVariants) {
        if (variant.id == id) return variant;
      }
    }
    return null;
  }

  int get count => bag.values.fold(0, (sum, value) => sum + value);
  int get subtotal => bag.entries.fold(
    0,
    (sum, entry) => sum + (sku(entry.key)?.priceCents ?? 0) * entry.value,
  );
  void quantity(String id, int quantity) {
    final item = sku(id);
    if (item == null) return;
    final next = quantity.clamp(0, max(0, min(10, item.inventory))).toInt();
    if (next == 0) {
      bag.remove(id);
    } else {
      bag[id] = next;
    }
    _changed();
  }

  void toggleFavorite(String id) {
    if (!favorites.remove(id)) favorites.add(id);
    _changed();
  }

  void setLocale(String value) {
    if (['en', 'zh', 'es'].contains(value)) {
      locale = value;
      _changed();
    }
  }

  void setDestination(String value) {
    if (catalog?.destinations.containsKey(value) ?? false) {
      destination = value;
      _changed();
    }
  }

  void clearBag() {
    bag.clear();
    _checkoutKey = null;
    _checkoutHash = null;
    _changed();
  }

  Future<String> checkoutKeyFor(Map<String, dynamic> input) async {
    final fingerprint = sha256
        .convert(utf8.encode(jsonEncode(_canonicalCheckoutIntent(input))))
        .toString();
    final legacyFingerprint = sha256.convert(utf8.encode(jsonEncode(input))).toString();
    if (_checkoutKey != null && _checkoutHash == legacyFingerprint) {
      _checkoutHash = fingerprint;
    }
    if (_checkoutHash != fingerprint || _checkoutKey == null) {
      _checkoutHash = fingerprint;
      _checkoutKey = newIdempotencyKey();
    }
    // Persist only an opaque key/hash, never the customer's address or contact fields.
    await _writes;
    await drafts.write(_draftJson());
    return _checkoutKey!;
  }

  String _draftJson() => jsonEncode({
    'locale': locale,
    'destination': destination,
    'bag': bag,
    'favorites': favorites.toList(),
    'checkoutKey': _checkoutKey,
    'checkoutHash': _checkoutHash,
  });

  void _changed() {
    final json = _draftJson();
    _writes = _writes.then((_) => drafts.write(json)).catchError((Object _) {});
    _notify();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    api.close();
    super.dispose();
  }
}

String newIdempotencyKey() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  final hex = bytes
      .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
      .join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

Map<String, dynamic> _canonicalCheckoutIntent(Map<String, dynamic> input) {
  final normalized = <String, dynamic>{};
  for (final key in [
    'email', 'firstName', 'lastName', 'address', 'apartment', 'city',
    'region', 'postal', 'phone', 'destination', 'deliveryMethod',
    'marketingOptIn', 'shippingRevision', 'expectedSubtotalCents',
    'expectedShippingCents',
  ]) {
    if (!input.containsKey(key)) continue;
    final value = input[key];
    normalized[key] = value is String
        ? (key == 'email' ? value.trim().toLowerCase() : value.trim())
        : value;
  }
  final items = input['items'];
  if (items is List) {
    final lines = items.map((item) {
      final line = Map<String, dynamic>.from(item as Map);
      return <String, dynamic>{
        'id': (line['id'] as String).trim(),
        'quantity': line['quantity'],
      };
    }).toList()
      ..sort((a, b) => (a['id'] as String).compareTo(b['id'] as String));
    normalized['items'] = lines;
  }
  return normalized;
}
