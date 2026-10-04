import 'package:flutter/widgets.dart';

import '../state/store_model.dart';

class StoreScope extends InheritedNotifier<StoreModel> {
  const StoreScope({super.key, required StoreModel model, required super.child})
    : super(notifier: model);
  static StoreModel of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<StoreScope>()!.notifier!;
}
