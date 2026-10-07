import { NextResponse } from "next/server";
import { requirePermission } from "@/server/auth/require-permission";
import { createClient } from "@/lib/supabase/server";
import { errorResponse } from "@/server/http/api-error";

export async function GET() {
  try {
    const context = await requirePermission("orders.view");

    if (
      !["administrator", "finance", "sales_customer_service"].includes(
        context.role?.name ?? "",
      )
    ) {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 },
      );
    }

    const supabase = await createClient();

    const { data: orders, error } = await supabase
      .from("orders")
      .select(`
        id,
        customer_id,
        order_number,
        status,
        subtotal,
        delivery_fee,
        discount,
        total_amount,
        currency,
        delivery_address,
        delivery_notes,
        created_at,
        updated_at,
        order_items (
          id,
          order_id,
          product_id,
          product_name,
          unit_price,
          quantity,
          subtotal,
          created_at
        )
      `)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      orders: (orders ?? []).map((order) => ({
        ...order,
        items: order.order_items ?? [],
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}