const shippingMethods = ['standard', 'express', 'priority'];
const shippingCountries = ['US', 'CA', 'GB', 'DE', 'AU', 'FR'];
const _shippingReasons = [
  'country_not_served',
  'route_disabled',
  'carrier_disabled',
  'no_rule',
];

/// A validated server quote. Unavailable routes never supply a usable price.
class ShippingQuote {
  const ShippingQuote({
    required this.available,
    required this.country,
    required this.method,
    required this.revision,
    required this.shippingCents,
    required this.minDays,
    required this.maxDays,
    required this.ruleId,
    required this.carrierCode,
    required this.reason,
  });

  final bool available;
  final String country, method, revision;
  final int? shippingCents, minDays, maxDays;
  final String? ruleId, carrierCode, reason;

  factory ShippingQuote.fromJson(Map<String, dynamic> json) {
    final available = json['available'];
    final country = json['country'];
    final method = json['method'];
    final revision = json['revision'];
    final reason = json['reason'];
    if (available is! bool ||
        !shippingCountries.contains(country) ||
        !shippingMethods.contains(method) ||
        !_validRevision(revision) ||
        !json.containsKey('reason') ||
        (reason != null && !_shippingReasons.contains(reason))) {
      throw const FormatException('Invalid shipping quote');
    }
    final shippingCents = _nullableAmount(json, 'shippingCents');
    final minDays = _nullableAmount(json, 'minDays');
    final maxDays = _nullableAmount(json, 'maxDays');
    if (available &&
        (shippingCents == null || minDays == null || maxDays == null)) {
      throw const FormatException('Incomplete shipping quote');
    }
    if (minDays != null && maxDays != null && maxDays < minDays) {
      throw const FormatException('Invalid delivery estimate');
    }
    return ShippingQuote(
      available: available,
      country: country as String,
      method: method as String,
      revision: revision as String,
      shippingCents: shippingCents,
      minDays: minDays,
      maxDays: maxDays,
      ruleId: _nullableString(json, 'ruleId'),
      carrierCode: _nullableString(json, 'carrierCode'),
      reason: reason as String?,
    );
  }
}

class ShippingQuotes {
  const ShippingQuotes({
    required this.country,
    required this.subtotalCents,
    required this.weightGrams,
    required this.configured,
    required this.revision,
    required this.quotes,
  });

  final String country, revision;
  final int subtotalCents, weightGrams;
  final bool configured;
  final List<ShippingQuote> quotes;
  List<ShippingQuote> get available =>
      quotes.where((quote) => quote.available).toList();

  factory ShippingQuotes.fromJson(
    Map<String, dynamic> json, {
    required String country,
  }) {
    final rawQuotes = json['quotes'];
    if (json['ok'] != true ||
        json['apiVersion'] != 'v1' ||
        json['currency'] != 'USD' ||
        !shippingCountries.contains(country) ||
        json['country'] != country ||
        json['configured'] is! bool ||
        !_validRevision(json['revision']) ||
        rawQuotes is! List ||
        rawQuotes.length > shippingMethods.length) {
      throw const FormatException('Invalid shipping response');
    }
    final revision = json['revision'] as String;
    final quotes = rawQuotes
        .map(
          (value) =>
              ShippingQuote.fromJson(Map<String, dynamic>.from(value as Map)),
        )
        .toList();
    if (quotes.any(
          (quote) => quote.country != country || quote.revision != revision,
        ) ||
        quotes.map((quote) => quote.method).toSet().length != quotes.length) {
      throw const FormatException('Inconsistent shipping quotes');
    }
    return ShippingQuotes(
      country: country,
      subtotalCents: _amount(json['subtotalCents']),
      weightGrams: _amount(json['weightGrams']),
      configured: json['configured'] as bool,
      revision: revision,
      quotes: List.unmodifiable(quotes),
    );
  }
}

bool _validRevision(dynamic value) =>
    value is String && RegExp(r'^[a-f0-9]{64}$').hasMatch(value);

int _amount(dynamic value) {
  if (value is! int || value < 0 || value > 9007199254740991) {
    throw const FormatException('Invalid shipping amount');
  }
  return value;
}

int? _nullableAmount(Map<String, dynamic> json, String key) {
  if (!json.containsKey(key)) {
    throw const FormatException('Missing shipping amount');
  }
  return json[key] == null ? null : _amount(json[key]);
}

String? _nullableString(Map<String, dynamic> json, String key) {
  if (!json.containsKey(key) || (json[key] != null && json[key] is! String)) {
    throw const FormatException('Invalid shipping metadata');
  }
  return json[key] as String?;
}
