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
        MockClient(
          (request) async => http.Response(
            jsonEncode(catalogFixture),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          ),
        ),
  ),
  drafts: drafts ?? MemoryDrafts(),
);
