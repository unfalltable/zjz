class Product {
  const Product({
    required this.id,
    required this.name,
    required this.priceCents,
    required this.category,
    required this.image,
    required this.inventory,
    required this.description,
    required this.detail,
    required this.badge,
  });
  final String id, name, category, image;
  final int priceCents, inventory;
  final Map<String, String> description, detail, badge;
  factory Product.fromJson(Map<String, dynamic> json) => Product(
    id: json['id'] as String,
    name: json['name'] as String,
    priceCents: json['priceCents'] as int,
    category: json['category'] as String,
    image: json['image'] as String,
    inventory: json['inventory'] as int,
    description: Map<String, String>.from(json['description'] as Map),
    detail: Map<String, String>.from(json['detail'] as Map),
    badge: Map<String, String>.from(json['badge'] as Map),
  );
  String text(Map<String, String> values, String locale) =>
      values[locale] ?? values['en'] ?? '';
}

class Catalog {
  const Catalog({required this.products, required this.destinations});
  final List<Product> products;
  final Map<String, Map<String, String>> destinations;
  factory Catalog.fromJson(Map<String, dynamic> json) => Catalog(
    products: (json['products'] as List)
        .map(
          (value) => Product.fromJson(Map<String, dynamic>.from(value as Map)),
        )
        .toList(),
    destinations: (json['destinations'] as Map<String, dynamic>).map(
      (key, value) => MapEntry(key, Map<String, String>.from(value as Map)),
    ),
  );
}

class OrderReceipt {
  const OrderReceipt({required this.orderNumber, required this.totalCents});
  final String orderNumber;
  final int totalCents;
  factory OrderReceipt.fromJson(Map<String, dynamic> json) => OrderReceipt(
    orderNumber: json['orderNumber'] as String,
    totalCents: json['totalCents'] as int,
  );
}

String money(int cents) => 'US\$${(cents / 100).toStringAsFixed(2)}';
