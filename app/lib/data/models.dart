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
    this.listingId,
    this.sku,
    this.variantAttributes = const {},
    this.variants = const [],
  });

  final String id, name, category, image;
  final String? listingId, sku;
  final int priceCents, inventory;
  final Map<String, String> description, detail, badge, variantAttributes;
  final List<Product> variants;

  /// A listing groups independently stocked SKUs, including its root SKU.
  List<Product> get saleVariants => variants.isEmpty ? [this] : variants;
  int get listingInventory => saleVariants.fold(
    0,
    (total, variant) => total + variant.inventory,
  );
  int get listingPriceCents {
    final available = saleVariants.where((variant) => variant.inventory > 0);
    final priced = available.isNotEmpty ? available : saleVariants;
    return priced
        .map((variant) => variant.priceCents)
        .reduce((a, b) => a < b ? a : b);
  }
  String get variantLabel => variantAttributes.entries
      .map((entry) => '${entry.key}: ${entry.value}')
      .join(' / ');

  factory Product.fromJson(Map<String, dynamic> json) => _fromJson(json);

  static Product _fromJson(Map<String, dynamic> json, {bool nested = false}) {
    if (nested && json.containsKey('variants')) {
      throw const FormatException('Nested product variants are invalid');
    }
    final rawVariants = json['variants'];
    if (rawVariants != null && (rawVariants is! List || rawVariants.isEmpty)) {
      throw const FormatException('Product variants are invalid');
    }
    final variants = rawVariants == null
        ? <Product>[]
        : (rawVariants as List)
              .map(
                (value) => _fromJson(
                  Map<String, dynamic>.from(value as Map),
                  nested: true,
                ),
              )
              .toList();
    final product = Product(
      id: json['id'] as String,
      name: json['name'] as String,
      priceCents: json['priceCents'] as int,
      category: json['category'] as String,
      image: json['image'] as String,
      inventory: json['inventory'] as int,
      description: Map<String, String>.from(json['description'] as Map),
      detail: Map<String, String>.from(json['detail'] as Map),
      badge: Map<String, String>.from(json['badge'] as Map),
      listingId: json['listingId'] as String?,
      sku: json['sku'] as String?,
      variantAttributes: json['variantAttributes'] == null
          ? const {}
          : Map<String, String>.from(json['variantAttributes'] as Map),
      variants: variants,
    );
    if (product.inventory < 0 || product.priceCents < 0) {
      throw const FormatException('Product price or inventory is invalid');
    }
    if (variants.isNotEmpty) {
      final roots = variants.where((variant) => variant.id == product.id);
      if (roots.length != 1 ||
          roots.single.priceCents != product.priceCents ||
          roots.single.inventory != product.inventory ||
          variants.any((variant) => variant.listingId != product.id)) {
        throw const FormatException('Product variants do not match listing');
      }
    }
    return product;
  }

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
