import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:miova_app/data/commerce_api.dart';
import 'package:miova_app/data/local_drafts.dart';
import 'package:miova_app/state/store_model.dart';

const catalogFixture = {
  'ok': true,
  'currency': 'USD',
  'products': [
    {
      'id': 'nova',
      'name': 'Nova Orb Speaker',
      'priceCents': 12900,
      'category': 'tech',
      'inventory': 2,
      'image': '/products/nova.webp',
      'description': {
        'en': 'Wireless sound',
        'zh': '无线音响',
        'es': 'Sonido inalámbrico',
      },
      'detail': {
        'en': 'Room-filling sound',
        'zh': '空间音效',
        'es': 'Sonido envolvente',
      },
      'badge': {'en': 'New', 'zh': '新品', 'es': 'Nuevo'},
    },
  ],
  'destinations': {
    'US': {'en': 'United States', 'zh': '美国', 'es': 'Estados Unidos'},
  },
};

const shippingRevisionFixture =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

Map<String, dynamic> shippingFixture({
  String country = 'US',
  int subtotalCents = 12900,
  int shippingCents = 730,
  String revision = shippingRevisionFixture,
  List<String> availableMethods = const ['standard'],
  bool configured = true,
}) => {
  'ok': true,
  'apiVersion': 'v1',
  'country': country,
  'currency': 'USD',
  'subtotalCents': subtotalCents,
  'weightGrams': 500,
  'configured': configured,
  'revision': revision,
  'quotes': [
    for (final method in ['standard', 'express', 'priority'])
      {
        'available': availableMethods.contains(method),
        'country': country,
        'method': method,
        'revision': revision,
        'shippingCents': availableMethods.contains(method)
            ? shippingCents
            : null,
        'minDays': availableMethods.contains(method) ? 3 : null,
        'maxDays': availableMethods.contains(method) ? 7 : null,
        'ruleId': null,
        'carrierCode': null,
        'reason': availableMethods.contains(method) ? null : 'no_rule',
      },
  ],
};

class MemoryDrafts implements LocalDrafts {
  String? value;
  @override
  Future<String?> read() async => value;
  @override
  Future<void> write(String next) async {
    value = next;
  }
}

StoreModel testModel({MemoryDrafts? drafts, http.Client? client}) => StoreModel(
  api: CommerceApi(
    baseUrl: Uri.parse('https://store.example'),
    client:
        client ??
        MockClient((request) async {
          Map<String, dynamic> body;
          if (request.url.path == '/api/v1/catalog') {
            body = catalogFixture;
          } else if (request.url.path == '/api/v1/shipping') {
            final items =
                jsonDecode(request.url.queryParameters['items']!) as List;
            final subtotal = items.fold<int>(
              0,
              (total, item) => total + (item['quantity'] as int) * 12900,
            );
            body = shippingFixture(
              country: request.url.queryParameters['country']!,
              subtotalCents: subtotal,
              shippingCents: subtotal >= 7500 ? 0 : 890,
              availableMethods: const ['standard', 'express', 'priority'],
              configured: false,
            );
          } else {
            return http.Response('{"ok":false}', 404);
          }
          return http.Response(
            jsonEncode(body),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }),
  ),
  drafts: drafts ?? MemoryDrafts(),
);
