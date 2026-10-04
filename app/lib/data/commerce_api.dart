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

  Future<Catalog> catalog() async =>
      Catalog.fromJson(await _request('/api/v1/catalog'));
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
