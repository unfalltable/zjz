import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'models.dart';

class ApiException implements Exception {
  const ApiException(this.message);
  final String message;
  @override
  String toString() => message;
}

class CommerceApi {
  CommerceApi({required this.baseUrl, http.Client? client})
    : _client = client ?? http.Client();
  final Uri baseUrl;
  final http.Client _client;
  Uri uri(String path) => baseUrl.resolve(path);
  Future<Map<String, dynamic>> _request(
    String path, [
    Map<String, dynamic>? body,
  ]) async {
    try {
      final response =
          await (body == null
                  ? _client.get(uri(path))
                  : _client.post(
                      uri(path),
                      headers: {'Content-Type': 'application/json'},
                      body: jsonEncode(body),
                    ))
              .timeout(const Duration(seconds: 20));
      final json = jsonDecode(response.body) as Map<String, dynamic>;
      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          json['ok'] != true) {
        throw ApiException(
          json['message'] as String? ??
              'Service unavailable. Please try again.',
        );
      }
      return json;
    } on ApiException {
      rethrow;
    } on TimeoutException {
      throw const ApiException('Connection timed out. Please try again.');
    } catch (_) {
      throw const ApiException(
        'Could not connect to the store. Check your connection and try again.',
      );
    }
  }

  Future<Catalog> catalog() async {
    const incomplete = ApiException(
      'The product catalog is incomplete. Please try again.',
    );
    final products = <Product>[];
    final productIds = <String>{};
    final cursors = <String>{};
    Catalog? firstPage;
    var path = '/api/v1/catalog';
    var paginated = false;
    var pages = 0;

    try {
      while (true) {
        if (pages >= 1000) throw incomplete;
        pages += 1;
        final json = await _request(path);
        final page = Catalog.fromJson(json);
        firstPage ??= page;
        for (final product in page.products) {
          if (product.id.trim().isEmpty || !productIds.add(product.id)) {
            throw incomplete;
          }
          products.add(product);
        }

        // Only the first response may be from a legacy, single-page service.
        // Once pagination starts, a missing cursor envelope could truncate it.
        if (!json.containsKey('pageInfo')) {
          if (paginated) throw incomplete;
          break;
        }
        paginated = true;
        final info = json['pageInfo'];
        if (info is! Map<String, dynamic> ||
            info['hasMore'] is! bool ||
            !info.containsKey('nextCursor')) {
          throw incomplete;
        }
        final hasMore = info['hasMore'] as bool;
        final cursor = info['nextCursor'];
        if (!hasMore) {
          if (cursor != null) throw incomplete;
          break;
        }
        if (cursor is! String ||
            cursor.trim().isEmpty ||
            cursor.length > 4096 ||
            page.products.isEmpty ||
            !cursors.add(cursor)) {
          throw incomplete;
        }
        // Treat the cursor as opaque, not as a URL or query fragment.
        path = Uri(
          path: '/api/v1/catalog',
          queryParameters: {'cursor': cursor},
        ).toString();
      }
      // The caller receives a complete catalog, never a successful partial page.
      return Catalog(products: products, destinations: firstPage.destinations);
    } on ApiException {
      rethrow;
    } catch (_) {
      throw incomplete;
    }
  }

  Future<OrderReceipt> createOrder(Map<String, dynamic> input) async =>
      OrderReceipt.fromJson(await _request('/api/v1/orders', input));
  Future<Map<String, dynamic>> track(String orderNumber, String email) async =>
      (await _request('/api/v1/orders/track', {
            'orderNumber': orderNumber,
            'email': email,
          }))['order']
          as Map<String, dynamic>;
  void close() => _client.close();
}
