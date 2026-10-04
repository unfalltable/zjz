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
    loading = true;
    error = null;
    _notify();
    try {
      catalog = await api.catalog();
      if (!catalog!.destinations.containsKey(destination)) destination = 'US';
      final ids = catalog!.products.map((product) => product.id).toSet();
      bag.removeWhere((id, _) => !ids.contains(id));
      favorites.removeWhere((id) => !ids.contains(id));
      for (final product in catalog!.products) {
        if (bag.containsKey(product.id)) {
          bag[product.id] = min(bag[product.id]!, min(10, product.inventory));
        }
      }
      bag.removeWhere((_, quantity) => quantity <= 0);
    } catch (exception) {
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

  int get count => bag.values.fold(0, (sum, value) => sum + value);
  int get subtotal => bag.entries.fold(
    0,
    (sum, entry) => sum + (product(entry.key)?.priceCents ?? 0) * entry.value,
  );
  void quantity(String id, int quantity) {
    final item = product(id);
    if (item == null) return;
    final next = quantity.clamp(0, min(10, item.inventory)).toInt();
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
        .convert(utf8.encode(jsonEncode(input)))
        .toString();
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
